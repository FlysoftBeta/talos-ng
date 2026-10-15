import { createUlid } from "@talos/base";
import { createMemoryObjectStore } from "@talos/objectstore";
import { Audit } from "../../../kernel/diagnostics/audit.ts";
import { Jobs } from "../../../kernel/jobs/jobs.ts";
import { ObjectLedger } from "../../../kernel/objects/objects.ts";
import { UploadService } from "../../../kernel/objects/uploads.ts";
import { Db, migrate } from "../../../kernel/persistence/db.ts";
import { Uow } from "../../../kernel/persistence/uow.ts";
import { SyncHub } from "../../../kernel/sync/sync-hub.ts";
import { LinkHost } from "../../../kernel/transport/link-host.ts";
import { AuthorityService } from "../../authority/index.ts";
import {
  DirectoryRepo,
  ProvisioningRepo,
  identityMigrations,
} from "../../identity/index.ts";
import { registerAiApi } from "../api.ts";
import type { ModelProvider } from "../providers/responses.ts";
import { AiService } from "../service.ts";
import { FakeProvider } from "./provider.ts";
export function setupAi(
  provider: ModelProvider | undefined = new FakeProvider(async () => {}),
) {
  let time = Date.UTC(2026, 9, 12);
  const now = () => time,
    id = createUlid({ clock: now }),
    db = new Db(),
    hub = new SyncHub({ revision: () => uow.revision });
  const uow = new Uow(db, { committed: (set) => hub.committed(set) }),
    store = createMemoryObjectStore(),
    objects = new ObjectLedger({ db, uow, store, clock: now }),
    uploads = new UploadService({
      db,
      uow,
      store,
      ledger: objects,
      clock: now,
      id,
    }),
    jobs = new Jobs({ db, uow, clock: now, id });
  migrate(db, "identity", identityMigrations, now);
  const identity = new DirectoryRepo(db);
  const authority = new AuthorityService({ db, uow, now, identity });
  const users = [id(), id(), id()];
  users.forEach((user, index) =>
    uow.write((ctx) =>
      new ProvisioningRepo(db).createUser(
        {
          id: user,
          handle: `user${index}`,
          name: `用户${index}`,
          roles: index === 0 ? ["root"] : [],
          features: index < 2 ? ["ai", "offline"] : [],
          credentialVersion: 1,
        },
        user,
        now(),
        ctx.rev,
      ),
    ),
  );
  const service = new AiService({
    db,
    uow,
    jobs,
    uploads,
    store,
    now,
    provider,
    id,
    allowed: (u) => authority.can(u, "feature.use", { feature: "ai" }),
  });
  service.registerSync(hub);
  const host = new LinkHost({
    db,
    uow,
    build: "test",
    authenticate: (c) => ({ user: c.ctx.get("user") as string }),
    reportIncident: () => "incident",
  });
  registerAiApi(host, service, authority, new Audit(db, now));
  const fund = (user = users[0]!, amount = 100000000) =>
    service.billing.assign({ user, key: id(), amount, days: 0, note: "test" });
  return {
    db,
    uow,
    store,
    objects,
    uploads,
    jobs,
    hub,
    host,
    service,
    users,
    id,
    now,
    fund,
    setTime: (n: number) => {
      time = n;
    },
    close: () => {
      service.close();
      jobs.close();
      host.close();
      hub.clear();
      db.close();
    },
  };
}
