import type { HybridClock } from "@talos/base";
import { AppError } from "@talos/base";
import { contract } from "@talos/contract";
import type { Database } from "@talos/store";
import type { OutboxItem, Row } from "@talos/sync";
import type { SavedSession } from "../auth/session.ts";
import type { FileStorage } from "../files/environment.ts";
import type { EvictionManager } from "../files/eviction.ts";
import type { Nav } from "../navigation/index.ts";
import { createNav, isNav } from "../navigation/index.ts";
import type { ClientSnapshot } from "../lifecycle/snapshot.ts";
import type { RuntimeConfiguration as RuntimeOptions } from "../lifecycle/configuration.ts";
import type { StatusViewModel } from "../status/model.ts";
import type { StoredRow } from "./db.ts";
import type { typedCall } from "./link.ts";
import type { ModuleRegistry } from "./modules.ts";
import type { Repository } from "./repository.ts";
import { SyncEngine } from "./sync-engine.ts";

export interface SessionSyncControllerPorts {
  engine?: SyncEngine;
  snapshot: ClientSnapshot;
  db?: Database;
  modules: ModuleRegistry;
  generation: number;
  call: ReturnType<typeof typedCall>;
  closed: boolean;
  now: () => number;
  files?: FileStorage;
  collectFiles(): Promise<void>;
  timers: NonNullable<RuntimeOptions["timers"]>;
  report: (error: unknown) => void;
  cleanup: (() => void)[];
  saved?: SavedSession;
  publish(patch: Partial<ClientSnapshot>): void;
  repositories: Map<string, Repository<StoredRow>>;
  saveSession(): Promise<void>;
  clock: HybridClock;
  status(patch: Partial<StatusViewModel>): void;
  retry(id: string): Promise<void>;
  discard(id: string): Promise<void>;
  eviction?: EvictionManager;
}

export class SessionSyncController {
  constructor(private readonly ports: SessionSyncControllerPorts) {}
  async prepareUser(
    session: SavedSession,
    replace: boolean = false,
  ): Promise<void> {
    if (
      !replace &&
      this.ports.engine &&
      this.ports.snapshot.user?.id === session.user.id
    )
      return;
    this.ports.engine?.close();
    const engine = new SyncEngine({
      db: this.ports.db!,
      user: session.user.id,
      modules: this.ports.modules,
      call: async (method, args, options) => {
        const generation = this.ports.generation;
        try {
          const result = await this.ports.call(method, args, options);
          if (
            this.ports.engine !== engine ||
            this.ports.closed ||
            generation !== this.ports.generation
          )
            throw new AppError("E_CANCELLED", "旧会话请求已取消");
          return result;
        } catch (error) {
          if (
            this.ports.engine !== engine ||
            this.ports.closed ||
            generation !== this.ports.generation
          )
            throw new AppError("E_CANCELLED", "旧会话请求已取消");
          throw error;
        }
      },
      now: this.ports.now,
      onGone: async (scopes) => {
        const generation = this.ports.generation;
        const db = this.ports.db!;
        const files = this.ports.files!;
        const current = (): void => {
          if (
            this.ports.engine !== engine ||
            this.ports.closed ||
            generation !== this.ports.generation
          )
            throw new AppError("E_CANCELLED", "旧会话清理已取消");
        };
        for (const scope of scopes) {
          current();
          const prefix = `feature:${session.user.id}:${scope}:`;
          await db
            .table("kv")
            .deleteRange({ lower: prefix, upper: prefix + "\uffff" });
          current();
          const owners = await files.listByOwnerPrefix(
            `${session.user.id}:${scope}:`,
          );
          current();
          // Retire owners written before media cache entries used collection scopes.
          if (scope.startsWith("coll:")) {
            owners.push(
              ...(await files.listByOwnerPrefix(
                `${session.user.id}:media:${scope.slice(5)}:`,
              )),
            );
            current();
          }
          for (const owner of new Set(owners.map((row) => row.owner))) {
            current();
            await files.releaseOwner(owner);
          }
          current();
          await this.ports.collectFiles();
        }
      },
      timers: this.ports.timers,
      onError: (error) => {
        if (
          this.ports.engine === engine &&
          !this.ports.closed &&
          !(error instanceof AppError && error.code === "E_CANCELLED")
        )
          this.ports.report(error);
      },
    });
    this.ports.engine = engine;
    this.ports.cleanup.push(
      engine.subscribe(() => {
        if (this.ports.engine === engine) this.engineChanged();
      }),
    );
    const nav = await this.ports
      .db!.table<Nav, string>("nav")
      .get(session.user.id);
    if (
      this.ports.engine !== engine ||
      this.ports.closed ||
      this.ports.saved?.user.id !== session.user.id
    )
      return;
    this.ports.publish({
      user: session.user,
      nav: isNav(nav) ? nav : createNav(),
    });
    await engine.hydrate();
  }
  engineChanged(): void {
    const state = this.ports.engine!.getSnapshot();
    for (const repository of this.ports.repositories.values())
      repository.hydrate(state.rows);
    const profile = state.rows.find(
      (row) =>
        row.type === "profile" &&
        row.scope === `me:${this.ports.saved?.user.id}` &&
        !row.deleted,
    );
    if (profile && this.ports.saved) {
      const parsed = contract.auth.resume.result.shape.user.safeParse(
        profile.data,
      );
      if (
        parsed.success &&
        JSON.stringify(parsed.data) !== JSON.stringify(this.ports.saved.user)
      ) {
        const changedCredentials =
          parsed.data.credentialVersion !== undefined &&
          (this.ports.saved.credentialVersion ?? -1) <
            parsed.data.credentialVersion;
        this.ports.saved = {
          ...this.ports.saved,
          user: parsed.data,
          ...(changedCredentials
            ? {
                credentialVersion: parsed.data.credentialVersion,
                verifier: undefined,
                verifiers: undefined,
              }
            : {}),
        };
        this.ports.publish({ user: parsed.data });
        void this.ports.saveSession().catch(this.ports.report);
      }
    }
    for (const row of state.rows) {
      if (row.type !== "setting" || row.deleted) continue;
      const parsed = contract.me.setting.set.result.safeParse({
        setting: row.data,
      });
      if (parsed.success) this.ports.clock.observe(parsed.data.setting.value.t);
    }
    this.ports.status({
      connection:
        state.phase === "live"
          ? "connected"
          : state.phase === "syncing"
            ? "syncing"
            : state.phase === "offline"
              ? "offline"
              : "connecting",
      syncingCount: state.progress,
      lastSync:
        state.lastSync === undefined
          ? "尚未同步"
          : new Date(state.lastSync).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
            }),
      pending: state.outbox.filter((op) => op.state !== "failed").length,
      failed: state.outbox.filter((op) => op.state === "failed").length,
      operations: state.outbox.map((op) => ({
        id: op.op,
        title: this.ports.modules.operationTitle(op.method),
        state: op.state === "failed" ? "failed" : "pending",
        ...(op.state === "failed"
          ? {
              retry: () => {
                void this.ports.retry(op.op).catch(this.ports.report);
              },
              discard: () => {
                void this.ports.discard(op.op).catch(this.ports.report);
              },
            }
          : {}),
      })),
    });
  }
  hasScope(scope: string): boolean {
    return this.ports.engine?.getSnapshot().scopes.includes(scope) ?? false;
  }
  async flush(): Promise<void> {
    await this.ports.engine?.flush();
  }
  async sync(): Promise<void> {
    await this.ports.engine?.pull();
  }
  outbox(): readonly OutboxItem[] {
    return this.ports.engine?.getSnapshot().outbox ?? [];
  }
  async loadRows(scope: string, rows: readonly Row[]): Promise<void> {
    if (!this.ports.engine) throw new AppError("E_UNAUTHENTICATED", "请先登录");
    this.ports.eviction?.touch(scope);
    await this.ports.engine.loadRows(scope, rows);
    await this.ports.eviction?.makeRoom(0);
  }
}
