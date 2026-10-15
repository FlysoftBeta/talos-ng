import { BackupSnapshots } from "./backup/snapshot.ts";
import { createUlid } from "@talos/base";
import type { contract, ResultOf } from "@talos/contract";
import { digest } from "@talos/launcher";
import { join } from "node:path";
import { Backups } from "./backup/service.ts";
import type { HostTools } from "./host/adapter.ts";
import { createHostTools } from "./host/adapter.ts";
import type { OfficeCapture } from "./office/adapter.ts";
import { createOfficeCapture } from "./office/adapter.ts";
import { OfficeSessions } from "./office/service.ts";
import type { OpsDependencies, OpsOptions } from "./options.ts";
import { OpsRepo } from "./repo.ts";
import { Updates } from "./updates/service.ts";
export type { OpsDependencies, OpsOptions } from "./options.ts";
export class OpsService {
  readonly repo: OpsRepo;
  readonly backups: Backups;
  readonly updates: Updates;
  readonly host: HostTools;
  readonly office: OfficeCapture;
  private readonly id: () => string;
  private lastDay = -1;
  private stopped = false;
  private timer: unknown;
  private captureTask = Promise.resolve();
  start(): void {
    if (!this.office.available || !this.options.dataDir) return;
    const schedule = () => {
      this.timer = this.deps.clock.setTimeout(() => {
        this.captureTask = this.refreshOffice()
          .then(() => {})
          .catch((error) => this.deps.report(error))
          .finally(() => {
            if (!this.stopped) schedule();
          });
      }, 4000);
    };
    schedule();
  }
  async close(): Promise<void> {
    this.stopped = true;
    this.deps.clock.clearTimeout(this.timer);
    await this.captureTask;
    await this.backups.idle();
  }

  constructor(
    private readonly deps: OpsDependencies,
    readonly options: OpsOptions = {},
  ) {
    const service = () => this;
    const office = new OfficeSessions({
      get office() {
        return service().office;
      },
      get repo() {
        return service().repo;
      },

      get id() {
        return service().id;
      },
      get deps() {
        return service().deps;
      },
    });
    this.listOffice = office.listOffice.bind(office);
    this.refreshOffice = office.refreshOffice.bind(office);
    this.clearOffice = office.clearOffice.bind(office);
    this.officeDownload = office.officeDownload.bind(office);

    this.repo = new OpsRepo(deps.db, deps.now);
    this.id = createUlid({ clock: deps.now });
    this.backups = new Backups(
      this.repo,
      deps.store,
      deps.ledger,
      join(options.dataDir ?? ".data", "backups"),
      deps.now,
      new BackupSnapshots(deps.db),
    );
    this.updates = new Updates(
      this.repo,
      this.backups,
      join(options.dataDir ?? ".data", "updates"),
      deps.build,
      deps.now,
      options.bridge,
      options.fetch,
    );
    this.host = options.hostTools ?? createHostTools();
    this.office = options.officeCapture ?? createOfficeCapture();
    deps.jobs.register("ops.backup.daily", {
      concurrency: 1,
      timeoutMs: 2_147_483_647,
      onBoot: "requeue",
      run: () => this.backups.create(),
    });
  }
  https(): ResultOf<typeof contract.ops.https.status> {
    return (
      this.options.httpsStatus?.() ?? {
        domain: null,
        listeners: [],
        expiry: null,
        redirect: false,
        ca: false,
      }
    );
  }
  async stageUpload(
    user: string,
    id: string,
  ): Promise<ResultOf<typeof contract.ops.update.status>> {
    const object = this.deps.uploads.getCommitted(user, id);
    return this.updates.stage(await this.deps.store.readAll(object.id));
  }
  readonly listOffice: OfficeSessions["listOffice"];
  readonly refreshOffice: OfficeSessions["refreshOffice"];
  readonly clearOffice: OfficeSessions["clearOffice"];
  readonly officeDownload: OfficeSessions["officeDownload"];
  async backupDownload(
    user: string,
    id: string,
  ): Promise<ResultOf<typeof contract.ops.backup.download>> {
    this.backups.path(id);
    const row = this.repo.backups().find((item) => item.id === id)!;
    // A capability identity only: no archive is buffered or copied into object storage.
    const objectId = digest(Buffer.from(`backup:${id}`));
    this.repo.addDownload(objectId, user, this.deps.now() + 300_000, id);
    return this.deps.tickets.issue({
      user,
      objectId,
      filename: `${id}.talos-backup`,
      mime: "application/octet-stream",
      source: { size: row.size, read: () => this.backups.download(id) },
    });
  }

  async maintain(): Promise<void> {
    if (!this.options.dataDir) return;
    for (const row of this.repo.expiredDownloads(this.deps.now())) {
      if (
        !this.repo.activeDownload(row.object_id, this.deps.now()) &&
        !this.deps.ledger.has(row.object_id)
      )
        await this.deps.store.delete(row.object_id);
    }
    this.repo.clearExpiredDownloads(this.deps.now());
    const day = Math.floor((this.deps.now() + 8 * 3600_000) / 86_400_000);
    const latest = this.repo.backups()[0];
    if (
      this.repo.settings().daily &&
      day !== this.lastDay &&
      (!latest ||
        Math.floor((latest.created + 8 * 3600_000) / 86_400_000) < day)
    ) {
      const root = this.deps.identity.storedRoot();
      if (root) {
        this.deps.jobs.enqueue(root.id, "ops.backup.daily", {});
        this.lastDay = day;
      }
    }
    await this.updates.autoCheck();
  }
}
