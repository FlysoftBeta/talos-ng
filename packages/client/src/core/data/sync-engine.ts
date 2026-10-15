import { AppError, Emitter, Semaphore } from "@talos/base";
import { contract } from "@talos/contract";
import type { ResultOf } from "@talos/contract";
import {
  IntervalSet,
  isTerminalRejection,
  nextToSend,
  planApply,
  reduceOutbox,
} from "@talos/sync";
import type {
  OutboxEvent,
  OutboxItem,
  ScopePull,
  Row,
  IntervalSetJSON,
} from "@talos/sync";
import type { Database } from "@talos/store";
import type { StoredRow, StoredScope } from "./db.ts";

import type { TypedCall } from "./link.ts";
import type { ModuleRegistry } from "./modules.ts";
import { methodRegistry } from "@talos/contract";

export type SyncPhase =
  "offline" | "connecting" | "authenticating" | "syncing" | "live";
export interface SyncSnapshot {
  phase: SyncPhase;
  progress: number;
  locked: boolean;
  updating: boolean;
  lastSync?: number;
  rows: readonly StoredRow[];
  outbox: readonly OutboxItem[];
  scopes: readonly string[];
}
export interface EngineOptions {
  db: Database;
  user: string;
  modules: ModuleRegistry;
  call: TypedCall;
  now?: () => number;
  timers: {
    set(fn: () => void, ms: number): unknown;
    clear(id: unknown): void;
  };
  onError?: (error: unknown) => void;
  onGone?: (scopes: readonly string[]) => Promise<void>;
}
const sendOptions = { maxInFlight: 1, orderKey: (): string => "fifo" };
export class SyncEngine {
  private snapshot: SyncSnapshot = {
    phase: "offline",
    progress: 0,
    locked: true,
    updating: false,
    rows: [],
    outbox: [],
    scopes: [],
  };
  private readonly events = new Emitter<void>();
  private readonly writes = new Semaphore(1);
  private readonly pulls = new Semaphore(1);
  private online = false;
  private generation = 0;
  private flushing?: Promise<void>;
  private retryTimer?: unknown;
  private retryBlocked = false;
  private readonly now: () => number;
  private readonly timers: NonNullable<EngineOptions["timers"]>;
  constructor(private readonly options: EngineOptions) {
    this.now = options.now ?? Date.now;
    this.timers = options.timers;
  }
  getSnapshot = (): SyncSnapshot => this.snapshot;
  subscribe = (fn: () => void): (() => void) => this.events.on(fn);
  private publish(patch: Partial<SyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.events.emit();
  }
  sideState(locked: boolean, updating = this.snapshot.updating): void {
    this.publish({ locked, updating });
  }
  phase(phase: SyncPhase): void {
    this.publish({ phase });
  }
  async hydrate(): Promise<void> {
    await this.change({ type: "connectionLost" });
  }
  async refreshLocal(): Promise<void> {
    await this.refresh();
  }
  private async refresh(): Promise<void> {
    const { db, user, modules } = this.options;
    const [rows, outbox, lastSync, admitted] = await Promise.all([
      db.table<StoredRow>("rows").range(),
      db.table<readonly OutboxItem[], string>("outbox").get(user),
      db.table<number, string>("kv").get(`lastSync:${user}`),
      db.table<readonly string[], string>("kv").get(`scopes:${user}`),
    ]);
    // Every engine owns a per-account set of admitted scopes; other users' me rows never project.
    const visible = rows.filter((row) => (admitted ?? []).includes(row.scope));
    this.publish({
      rows: modules.project(visible, outbox ?? [], user),
      outbox: outbox ?? [],
      scopes: admitted ?? [],
      lastSync,
    });
  }
  private async change(event: OutboxEvent): Promise<void> {
    await this.writes.run(async () => {
      const { db, user } = this.options;
      await db.tx(["outbox"], "readwrite", (tx) => {
        const table = tx.table<readonly OutboxItem[], string>("outbox");
        return table
          .get(user)
          .then((items) =>
            table.put(reduceOutbox(items ?? [], event, sendOptions), user),
          );
      });
      await this.refresh();
    });
  }
  async enqueue(item: {
    op: string;
    method: string;
    args: unknown;
    createdAt: number;
  }): Promise<void> {
    if (!this.options.modules.supports(item.method))
      throw new AppError("E_INVALID", "此操作未注册离线处理器");
    await this.change({ type: "enqueue", item });
    this.flushInBackground();
  }
  async retry(op: string): Promise<void> {
    await this.change({ type: "retry", op });
    this.flushInBackground();
  }
  async discard(op: string): Promise<void> {
    await this.change({ type: "discard", op });
    this.flushInBackground();
  }
  async ack(op: string): Promise<void> {
    await this.change({ type: "acked", op });
  }
  disconnect(): void {
    this.online = false;
    ++this.generation;
    this.timers.clear(this.retryTimer);
    this.retryBlocked = false;
    this.publish({ phase: "offline" });
    // In-flight callbacks settle through their generation fence before the next flush.
  }
  async connect(): Promise<void> {
    const generation = ++this.generation;
    this.online = true;
    this.retryBlocked = false;
    this.timers.clear(this.retryTimer);
    this.publish({ phase: "syncing", progress: 0 });
    await this.pull();
    if (!this.online || generation !== this.generation) return;
    this.publish({ phase: "live" });
    await this.flush();
  }
  async pull(): Promise<void> {
    await this.pulls.run(async () => {
      const { db, call, user } = this.options;
      const generation = this.generation;
      const admitted =
        (await db
          .table<readonly string[], string>("kv")
          .get(`scopes:${user}`)) ?? [];
      const scopes = await db.table<StoredScope>("scopes").range();
      const cursors: Record<string, number> = {};
      for (const scope of scopes)
        if (admitted.includes(scope.scope)) cursors[scope.scope] = scope.cursor;
      const pages = new Map<string, ScopePull[]>();
      const gone = new Set<string>();
      let more: boolean;
      do {
        const response = await call(contract.sync.pull, { cursors });
        if (generation !== this.generation) return;
        more = false;
        for (const scope of response.gone) {
          gone.add(scope);
          delete cursors[scope];
          pages.delete(scope);
        }
        for (const [scope, page] of Object.entries(response.scopes)) {
          const list = pages.get(scope) ?? [];
          // Another scope can require more pages after this scope completed.
          // Continue its buffered history without dropping newer rows or resets.
          if (list.length)
            list[list.length - 1] = { ...list[list.length - 1]!, more: true };
          list.push(page);
          pages.set(scope, list);
          cursors[scope] = page.cursor;
          more = more || page.more;
          this.publish({ progress: this.snapshot.progress + page.rows.length });
        }
      } while (more);
      await this.applyPages(pages, [...gone]);
    });
  }
  async delta(response: ResultOf<typeof contract.sync.pull>): Promise<void> {
    const pages = new Map<string, ScopePull[]>();
    for (const [scope, page] of Object.entries(response.scopes)) {
      if (page.more) {
        await this.pull();
        return;
      }
      pages.set(scope, [page]);
    }
    await this.applyPages(pages, response.gone);
    if (response.added.length && this.online) await this.pull();
  }
  private async applyPages(
    pages: Map<string, ScopePull[]>,
    gone: readonly string[],
  ): Promise<void> {
    await this.writes.run(async () => {
      const { db, user } = this.options;
      await db.tx(["rows", "scopes", "kv"], "readwrite", (tx) => {
        const rows = tx.table<StoredRow>("rows");
        const scopes = tx.table<StoredScope, string>("scopes");
        return rows.range().then((existing) =>
          scopes.range().then((saved) =>
            tx
              .table<readonly string[], string>("kv")
              .get(`scopes:${user}`)
              .then((allowed) => {
                const admitted = new Set(allowed ?? []);
                const key = (
                  row: Pick<StoredRow, "scope" | "type" | "id">,
                ): string => JSON.stringify([row.scope, row.type, row.id]);
                const current = new Map(existing.map((row) => [key(row), row]));
                const cursors = new Map(
                  saved.map((scope) => [scope.scope, scope.cursor]),
                );
                for (const scope of gone) {
                  admitted.delete(scope);
                  scopes.delete(scope);
                  for (const row of existing)
                    if (row.scope === scope)
                      rows.delete([scope, row.type, row.id]);
                }
                for (const [scope, chain] of pages) {
                  if (gone.includes(scope)) continue;
                  admitted.add(scope);
                  const cursor = cursors.get(scope) ?? 0;
                  // A pushed newer revision can overtake a completed pull; never regress it.
                  if (chain[chain.length - 1]!.cursor < cursor) continue;
                  const operations = planApply(
                    {
                      cursor: Math.min(cursor, chain[0]!.cursor),
                      windows:
                        saved.find((item) => item.scope === scope)?.windows ??
                        {},
                    },
                    chain,
                    { windowed: this.options.modules.windowed },
                  );
                  const windows: Record<string, IntervalSetJSON> = {
                    ...saved.find((item) => item.scope === scope)?.windows,
                  };
                  for (const operation of operations) {
                    if (operation.kind === "dropType") {
                      for (const row of current.values())
                        if (
                          row.scope === scope &&
                          row.type === operation.type
                        ) {
                          rows.delete([scope, row.type, row.id]);
                          current.delete(key(row));
                        }
                    } else if (
                      operation.kind === "put" ||
                      operation.kind === "delete"
                    ) {
                      const row =
                        operation.kind === "put"
                          ? operation.row
                          : {
                              type: operation.type,
                              id: operation.id,
                              rev: operation.rev,
                              deleted: true,
                              data: this.options.modules.windowed[
                                operation.type
                              ]
                                ? (chain
                                    .reduce<Row[]>(
                                      (rows, page) => rows.concat(page.rows),
                                      [],
                                    )
                                    .find(
                                      (row) =>
                                        row.type === operation.type &&
                                        row.id === operation.id &&
                                        row.rev === operation.rev,
                                    )?.data ?? null)
                                : null,
                            };
                      const stored = { ...row, scope };
                      const old = current.get(key(stored));
                      if (
                        (!old || old.rev < row.rev) &&
                        !(
                          old?.deleted &&
                          this.options.modules.windowed[row.type] &&
                          !row.deleted
                        )
                      ) {
                        rows.put(stored);
                        current.set(key(stored), stored);
                      }
                    } else if (operation.kind === "setWindow")
                      windows[operation.type] = operation.intervals;
                    else if (operation.kind === "setCursor")
                      scopes.put({
                        scope,
                        cursor: operation.cursor,
                        ...(Object.keys(windows).length ? { windows } : {}),
                      });
                  }
                }
                tx.table<readonly string[], string>("kv").put(
                  [...admitted],
                  `scopes:${user}`,
                );
                return tx
                  .table<number, string>("kv")
                  .put(this.now(), `lastSync:${user}`);
              }),
          ),
        );
      });
      await this.refresh();
      if (gone.length) await this.options.onGone?.(gone);
    });
  }
  /** Admit fetched window pages without advancing the scope revision cursor. */
  async loadRows(scope: string, incoming: readonly Row[]): Promise<void> {
    await this.writes.run(async () => {
      const { db, user, modules } = this.options;
      await db.tx(["rows", "scopes", "kv"], "readwrite", (tx) =>
        tx
          .table<readonly string[], string>("kv")
          .get(`scopes:${user}`)
          .then((admitted) => {
            if (!(admitted ?? []).includes(scope))
              throw new AppError("E_DENIED", "对话访问权限已失效");
            return tx
              .table<StoredScope, string>("scopes")
              .get(scope)
              .then((saved) => {
                const windows: Record<string, IntervalSetJSON> = {
                  ...saved?.windows,
                };
                const rows = tx.table<StoredRow>("rows");
                return rows
                  .getMany(incoming.map((row) => [scope, row.type, row.id]))
                  .then((existing) => {
                    incoming.forEach((row, i) => {
                      const previous = existing[i];
                      if (
                        (!previous || previous.rev < row.rev) &&
                        !(
                          previous?.deleted &&
                          modules.windowed[row.type] &&
                          !row.deleted
                        )
                      )
                        rows.put({ ...row, scope });
                      const config = modules.windowed[row.type];
                      if (config)
                        windows[row.type] = new IntervalSet(windows[row.type])
                          .add(config.seqOf(row))
                          .toJSON();
                    });
                    return tx
                      .table<StoredScope, string>("scopes")
                      .put({ scope, cursor: saved?.cursor ?? 0, windows });
                  });
              });
          }),
      );
      await this.refresh();
    });
  }
  private flushInBackground(): void {
    void this.flush().catch((error: unknown) => this.options.onError?.(error));
  }
  async flush(): Promise<void> {
    if (this.retryBlocked) return;
    if (this.flushing) {
      await this.flushing;
      if (
        this.online &&
        !this.retryBlocked &&
        nextToSend(this.snapshot.outbox, sendOptions).length
      )
        return this.flush();
      return;
    }
    this.flushing = this.runFlush();
    try {
      await this.flushing;
    } finally {
      this.flushing = undefined;
    }
  }
  private async runFlush(): Promise<void> {
    while (this.online) {
      const item = nextToSend(this.snapshot.outbox, sendOptions)[0];
      if (!item) return;
      const generation = this.generation;
      await this.change({ type: "sendStarted", op: item.op });
      if (!this.online || generation !== this.generation) {
        await this.change({ type: "connectionLost" });
        return;
      }
      try {
        const method = methodRegistry[item.method];
        if (!method) throw new AppError("E_INVALID", "未知的排队操作");
        await this.options.call(method, item.args, { op: item.op });
        // Authoritative pull precedes removal of the optimistic layer, including duplicate acks.
        await this.pull();
        await this.ack(item.op);
      } catch (cause) {
        if (generation !== this.generation || !this.online) {
          await this.change({ type: "connectionLost" });
          return;
        }
        const error =
          cause instanceof AppError
            ? cause
            : new AppError("E_DISCONNECTED", "连接已断开");
        if (
          error.code === "E_UNAUTHENTICATED" ||
          error.code === "E_LOCKED" ||
          (error.code === "E_DENIED" &&
            !!(error.data as { reason?: string } | undefined)?.reason)
        ) {
          this.disconnect();
          await this.change({ type: "connectionLost" });
          this.options.onError?.(error);
          return;
        }
        const terminal = isTerminalRejection(error.code);
        await this.change({
          type: terminal ? "rejected" : "transportFailed",
          op: item.op,
          error: error.toJSON(),
        });
        if (terminal) {
          if (this.online) await this.pull();
        } else {
          if (this.online) {
            this.timers.clear(this.retryTimer);
            this.retryBlocked = true;
            this.retryTimer = this.timers.set(
              () => {
                this.retryBlocked = false;
                this.flushInBackground();
              },
              this.snapshot.outbox.find((op) => op.op === item.op)
                ?.retryAfterMs ?? 500,
            );
          }
          return;
        }
      }
      if (generation !== this.generation) return;
    }
  }
  close(): void {
    this.disconnect();
    this.events.clear();
  }
}
