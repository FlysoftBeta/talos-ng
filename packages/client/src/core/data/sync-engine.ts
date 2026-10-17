import { AppError, Emitter, Semaphore } from "@talos/base";
import { MAX_PUSH_OPS, contract, syncResultSchema } from "@talos/contract";
import type { JsonValue, ResultOf } from "@talos/contract";
import {
  EMPTY_COVERAGE,
  EMPTY_REPLICA,
  cursorOf,
  holdsWindow,
  holes,
  isComplete,
  isTerminalRejection,
  mergeReplica,
  nextToSend,
  reduceOutbox,
} from "@talos/sync";
import type {
  Coverage,
  Inbound,
  IntervalSetJSON,
  OutboxEvent,
  OutboxItem,
  Replica,
  ScopePull,
} from "@talos/sync";
import type { Database, LockManagerLike } from "@talos/store";
import type { StoredRow, StoredScope } from "./db.ts";
import { ScopeLocks, readReplicas, writeReplica } from "./scope-store.ts";

import type { TypedCall } from "./link.ts";
import type { ModuleRegistry } from "./modules.ts";
import { methodRegistry } from "@talos/contract";

/** What features merge themselves: fetched window pages and individually read rows. */
export type WindowInput = Extract<Inbound, { kind: "page" | "rows" }>;

function chains(
  pages: ReadonlyMap<string, ScopePull[]>,
  from: Readonly<Record<string, number>>,
): Map<string, Inbound[]> {
  const out = new Map<string, Inbound[]>();
  for (const [scope, list] of pages)
    out.set(scope, [{ kind: "chain", from: from[scope] ?? 0, pages: list }]);
  return out;
}

/** Operations and argument bytes sent per flush request. */
const BATCH_OPERATIONS = MAX_PUSH_OPS;
const BATCH_BYTES = 64 * 1024;

export type SyncPhase =
  "offline" | "connecting" | "authenticating" | "syncing" | "live";
/** Pull progress of one scope: `ready` scopes are already usable while others page. */
export interface ScopeSync {
  scope: string;
  state: "waiting" | "loading" | "ready";
  rows: number;
}
export interface SyncSnapshot {
  phase: SyncPhase;
  progress: number;
  locked: boolean;
  updating: boolean;
  lastSync?: number;
  cacheReady: boolean;
  rows: readonly StoredRow[];
  outbox: readonly OutboxItem[];
  scopes: readonly string[];
  /** Empty unless a pull is (or was interrupted while) paging. */
  scopeSync: readonly ScopeSync[];
  /** Stored coverage of the admitted scopes. */
  coverage: Readonly<Record<string, Coverage>>;
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
  /** Cross-tab scope locks; defaults to `navigator.locks` when present. */
  locks?: LockManagerLike | null;
}
export class SyncEngine {
  private snapshot: SyncSnapshot = {
    phase: "offline",
    progress: 0,
    cacheReady: false,
    locked: true,
    updating: false,
    rows: [],
    outbox: [],
    scopes: [],
    scopeSync: [],
    coverage: {},
  };
  private readonly events = new Emitter<void>();
  private readonly writes = new Semaphore(1);
  private readonly pulls = new Semaphore(1);
  private online = false;
  private generation = 0;
  private flushing?: Promise<void>;
  private retryTimer?: unknown;
  private retryBlocked = false;
  private debounceTimer?: unknown;
  private pullRetryTimer?: unknown;
  private pullFailures = 0;
  private needsPull = false;
  private readonly revocations = new Map<string, number>();
  /** Per scope, the revision this connection's push stream continues from. */
  private readonly served = new Map<string, number>();
  /** Scopes whose pushes carry windowed rows on this connection. */
  private readonly pushesWindowed = new Set<string>();
  private readonly locks: ScopeLocks;
  private readonly sendOptions;
  private readonly now: () => number;
  private readonly timers: NonNullable<EngineOptions["timers"]>;
  constructor(private readonly options: EngineOptions) {
    this.sendOptions = {
      maxInFlight: BATCH_OPERATIONS,
      orderKey: (method: string, args: unknown) =>
        options.modules.orderKey(method, args),
      register: (method: string, args: unknown) =>
        options.modules.register(method, args),
      merge: (method: string, earlier: unknown, later: unknown) =>
        options.modules.merge(method, earlier, later),
    };
    this.now = options.now ?? Date.now;
    this.timers = options.timers;
    this.locks = new ScopeLocks(options.locks);
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
    const generation = this.generation;
    await this.change({ type: "connectionLost" });
    await this.writes
      .run(() => this.drainGone(generation))
      .catch((error: unknown) => this.options.onError?.(error));
  }
  async refreshLocal(): Promise<void> {
    await this.refresh();
  }
  private async refresh(): Promise<void> {
    const { db, user, modules } = this.options;
    const [rows, outbox, lastSync, admitted, scopes, partial] =
      await Promise.all([
        db.table<StoredRow>("rows").range(),
        db.table<readonly OutboxItem[], string>("outbox").get(user),
        db.table<number, string>("kv").get(`lastSync:${user}`),
        db.table<readonly string[], string>("kv").get(`scopes:${user}`),
        db.table<StoredScope>("scopes").range(),
        db.table<boolean, string>("kv").get(`partialSync:${user}`),
      ]);
    // Every engine owns a per-account set of admitted scopes; other users' me rows never project.
    const visible = rows.filter((row) => (admitted ?? []).includes(row.scope));
    const coverage: Record<string, Coverage> = {};
    for (const saved of scopes)
      if ((admitted ?? []).includes(saved.scope))
        coverage[saved.scope] = saved.coverage;
    this.publish({
      rows: modules.project(visible, outbox ?? [], user),
      outbox: outbox ?? [],
      scopes: admitted ?? [],
      coverage,
      lastSync,
      cacheReady:
        lastSync !== undefined &&
        partial !== true &&
        (admitted ?? []).every(
          (scope) => !!coverage[scope] && isComplete(coverage[scope]!),
        ),
    });
  }
  private async change(
    change: OutboxEvent | readonly OutboxEvent[],
    generation?: number,
  ): Promise<void> {
    const events: readonly OutboxEvent[] = Array.isArray(change)
      ? change
      : [change as OutboxEvent];
    await this.writes.run(async () => {
      if (generation !== undefined && generation !== this.generation) return;
      const { db, user } = this.options;
      await db.tx(["outbox"], "readwrite", (tx) => {
        const table = tx.table<readonly OutboxItem[], string>("outbox");
        return table.get(user).then((items) => {
          if (generation !== undefined && generation !== this.generation)
            return;
          let next = items ?? [];
          for (const event of events)
            next = reduceOutbox(
              next,
              event.type === "enqueue"
                ? {
                    ...event,
                    item: {
                      ...event.item,
                      dependsOn: [
                        ...new Set([
                          ...(event.item.dependsOn ?? []),
                          ...this.options.modules.dependencies(
                            event.item.method,
                            event.item.args,
                            next,
                          ),
                        ]),
                      ],
                    },
                  }
                : event,
              this.sendOptions,
            );
          return table.put(next, user);
        });
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
    // Bursts of register writes (drafts, read marks, reading progress) wait for a
    // quiet period and merge in the durable outbox; a deadline bounds the delay.
    const debounce = this.options.modules.debounceMs(item.method, item.args);
    const now = this.now();
    await this.change({
      type: "enqueue",
      item:
        debounce > 0
          ? { ...item, notBefore: now + debounce, deadline: now + 4 * debounce }
          : item,
    });
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
    this.served.clear();
    this.pushesWindowed.clear();
    this.timers.clear(this.retryTimer);
    this.retryBlocked = false;
    this.timers.clear(this.pullRetryTimer);
    this.pullRetryTimer = undefined;
    this.timers.clear(this.debounceTimer);
    this.debounceTimer = undefined;
    this.publish({ phase: "offline" });
    // In-flight callbacks settle through their generation fence before the next flush.
  }
  async connect(): Promise<void> {
    const generation = ++this.generation;
    this.served.clear();
    this.pushesWindowed.clear();
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
    const generation = this.generation;
    try {
      await this.pulls.run(async () => {
        if (generation !== this.generation) return;
        this.needsPull = true;
        this.publish({ progress: 0 });
        const revocations = new Map(this.revocations);
        const { db, user } = this.options;
        const admitted =
          (await db
            .table<readonly string[], string>("kv")
            .get(`scopes:${user}`)) ?? [];
        const saved = new Map(
          (await db.table<StoredScope>("scopes").range()).map((item) => [
            item.scope,
            item.coverage,
          ]),
        );
        // Each request base is the cursor the stored coverage proves. A chain from
        // there only adds facts, so other tabs, evictions and window pages that
        // commit meanwhile never invalidate it.
        const cursors: Record<string, number> = {};
        // Scopes without a held window need none of their windowed rows, which
        // are most of a large conversation's history; omitting them lets a
        // conversation's metadata finish (and open) on the first page.
        const windowed: string[] = [];
        const progress = new Map<string, ScopeSync>();
        for (const scope of admitted) {
          const coverage = saved.get(scope);
          if (coverage) {
            cursors[scope] = cursorOf(coverage);
            if (holdsWindow(coverage)) windowed.push(scope);
          }
          progress.set(scope, {
            scope,
            state: coverage && isComplete(coverage) ? "ready" : "waiting",
            rows: 0,
          });
        }
        const from: Record<string, number> = { ...cursors };
        const report = () =>
          this.publish({ scopeSync: [...progress.values()] });
        report();
        const pages = new Map<string, ScopePull[]>();
        const gone = new Set<string>();
        let more: boolean;
        do {
          const response = await this.pullResponse(
            cursors,
            windowed,
            generation,
          );
          if (!response) return;
          if (generation !== this.generation) return;
          more = response.repull === true;
          for (const scope of response.gone) {
            gone.add(scope);
            delete cursors[scope];
            delete from[scope];
            pages.delete(scope);
            this.served.delete(scope);
          }
          for (const [scope, page] of Object.entries(response.scopes)) {
            const list = pages.get(scope) ?? [];
            // Another scope can require more pages after this scope completed.
            // Continue its buffered history without dropping newer rows or resets.
            if (list.length)
              list[list.length - 1] = {
                ...list[list.length - 1]!,
                more: true,
              };
            list.push(page);
            pages.set(scope, list);
            cursors[scope] = page.cursor;
            more = more || page.more;
            // The server pushes a scope's changes from its final page on.
            if (!page.more) this.subscribed(scope, page);
            const known = progress.get(scope);
            if (known?.state !== "ready")
              progress.set(scope, {
                scope,
                state: "loading",
                rows: (known?.rows ?? 0) + page.rows.length,
              });
            this.publish({
              progress: this.snapshot.progress + page.rows.length,
            });
          }
          report();
          if (!more) break;
          // Scopes whose chain is already complete become usable while other
          // scopes keep paging. Each scope chain still merges atomically, and the
          // next chain of that scope continues from its top.
          const ready = new Map<string, ScopePull[]>();
          for (const [scope, chain] of pages)
            if (
              !gone.has(scope) &&
              !chain[chain.length - 1]!.more &&
              chain.some((page) => page.rows.length || page.reset?.length)
            )
              ready.set(scope, chain);
          // Revocations found by a pull stay with the final commit: a later page
          // may regrant the scope, which must not run its cleanup in between.
          if (!ready.size) continue;
          await this.commit(
            chains(ready, from),
            [],
            generation,
            revocations,
            "partial",
          );
          if (generation !== this.generation) return;
          for (const [scope, chain] of ready) {
            from[scope] = chain[chain.length - 1]!.cursor;
            pages.delete(scope);
            progress.set(scope, {
              scope,
              state: "ready",
              rows: progress.get(scope)?.rows ?? 0,
            });
          }
          report();
        } while (more);
        await this.commit(
          chains(pages, from),
          [...gone],
          generation,
          revocations,
          "pull",
        );
        if (generation === this.generation) {
          this.needsPull = false;
          this.publish({ scopeSync: [] });
        }
      });
      if (generation === this.generation) {
        this.timers.clear(this.pullRetryTimer);
        this.pullRetryTimer = undefined;
        this.pullFailures = 0;
        if (this.online) {
          this.publish({ phase: "live" });
          this.flushInBackground();
        }
      }
    } catch (error) {
      this.recoverPull(error, generation);
      throw error;
    }
  }
  /** Records where the server's push stream of a scope continues. */
  private subscribed(scope: string, page: ScopePull): void {
    this.served.set(scope, page.cursor);
    if (page.windowed) this.pushesWindowed.add(scope);
    else this.pushesWindowed.delete(scope);
  }
  private async pullResponse(
    cursors: Record<string, number>,
    windowed: readonly string[],
    generation: number,
  ): Promise<ResultOf<typeof contract.sync.pull> | undefined> {
    let response = await this.options.call(contract.sync.pull, {
      cursors,
      windowed: [...windowed],
    });
    const chunks: string[] = [];
    while (response.transfer) {
      if (generation !== this.generation) return;
      const transfer = response.transfer;
      chunks.push(transfer.chunk);
      if (!transfer.more) {
        try {
          const decoded = syncResultSchema.parse(JSON.parse(chunks.join("")));
          if (decoded.transfer || decoded.repull)
            throw new Error("Nested transfer");
          if (response.repull) {
            for (const page of Object.values(decoded.scopes)) page.more = true;
            return { ...decoded, repull: true };
          }
          return decoded;
        } catch {
          throw new AppError("E_PROTOCOL", "同步分片数据无效");
        }
      }
      response = await this.options.call(contract.sync.pull, {
        cursors,
        windowed: [...windowed],
        continuation: transfer.token,
      });
      if (!response.transfer)
        throw new AppError("E_PROTOCOL", "同步分片不完整");
    }
    return response;
  }
  private recoverPull(error: unknown, generation: number): void {
    if (!this.online || generation !== this.generation) return;
    if (this.pausesSync(error)) {
      this.disconnect();
      this.options.onError?.(error);
      return;
    }
    this.publish({ phase: "syncing" });
    if (this.pullRetryTimer !== undefined) return;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.pullFailures++, 6));
    this.pullRetryTimer = this.timers.set(() => {
      this.pullRetryTimer = undefined;
      if (!this.online || generation !== this.generation) return;
      void this.pull()
        .then(async () => {
          if (!this.online || generation !== this.generation) return;
          this.publish({ phase: "live" });
          await this.flush();
        })
        .catch((cause: unknown) => this.options.onError?.(cause));
    }, delay);
  }
  private pausesSync(error: unknown): boolean {
    return (
      error instanceof AppError &&
      (error.code === "E_VERSION" ||
        error.code === "E_UNAUTHENTICATED" ||
        error.code === "E_LOCKED" ||
        (error.code === "E_DENIED" &&
          !!(error.data as { reason?: string } | undefined)?.reason))
    );
  }
  async delta(response: ResultOf<typeof contract.sync.pull>): Promise<void> {
    const generation = this.generation;
    for (const scope of response.gone) {
      this.revocations.set(scope, (this.revocations.get(scope) ?? 0) + 1);
      this.served.delete(scope);
    }
    const revocations = new Map(this.revocations);
    // Each pushed page continues the scope's stream where the previous page or
    // pull ended; place it on arrival, before anything awaits. A page whose start
    // is unknown still merges its rows, but proves no revisions.
    const inputs = new Map<string, Inbound[]>();
    let unplaced = false;
    for (const [scope, page] of Object.entries(response.scopes)) {
      if (page.more) continue;
      const from = this.served.get(scope);
      if (from === undefined) unplaced = true;
      this.served.set(scope, Math.max(from ?? page.cursor, page.cursor));
      inputs.set(scope, [
        { kind: "chain", from: from ?? page.cursor, pages: [page] },
      ]);
    }
    try {
      // Revocation does not wait for a slow pull. Its epoch prevents that pull, or
      // any already queued delta, from readmitting the removed scope afterward.
      if (response.gone.length || inputs.size)
        await this.commit(
          inputs,
          response.gone,
          generation,
          revocations,
          "delta",
        );
      // An unplaced page needs a pull to prove its revisions, unless one runs.
      if (
        ((unplaced && !this.needsPull) ||
          response.repull ||
          response.added.length ||
          Object.values(response.scopes).some((page) => page.more)) &&
        this.online &&
        generation === this.generation
      )
        await this.pull();
      if (this.online && generation === this.generation)
        this.flushInBackground();
    } catch (error) {
      // A page that did not merge leaves its stream position unknown.
      if (generation === this.generation)
        for (const scope of inputs.keys()) this.served.delete(scope);
      this.recoverPull(error, generation);
      throw error;
    }
  }
  /**
   * Merges inbound changes into the stored replicas of their scopes, one
   * transaction under the scopes' locks. `gone` scopes are purged first.
   */
  private async commit(
    inputs: ReadonlyMap<string, readonly Inbound[]>,
    gone: readonly string[],
    generation: number,
    revocations: ReadonlyMap<string, number>,
    stage: "pull" | "partial" | "delta",
  ): Promise<void> {
    await this.writes.run(async () => {
      if (generation !== this.generation) return;
      const { db, user, modules } = this.options;
      const touched = [...new Set([...gone, ...inputs.keys()])];
      await this.locks.run(touched, () =>
        db.tx(["rows", "scopes", "kv"], "readwrite", (tx) => {
          const kv = tx.table<unknown, string>("kv");
          return tx
            .table<readonly string[], string>("kv")
            .getMany([`scopes:${user}`, `cleanupScopes:${user}`])
            .then(([allowed, pendingCleanup]) =>
              readReplicas(tx, touched, (held) => {
                if (generation !== this.generation) return;
                const admitted = new Set(allowed ?? []);
                const cleanup = new Set(pendingCleanup ?? []);
                const next = new Map<string, Replica>();
                const current = (scope: string): Replica =>
                  next.get(scope) ?? held.get(scope)!.replica;
                for (const scope of gone) {
                  admitted.delete(scope);
                  cleanup.add(scope);
                  next.set(scope, EMPTY_REPLICA);
                }
                for (const [scope, list] of inputs) {
                  if (
                    (this.revocations.get(scope) ?? 0) !==
                    (revocations.get(scope) ?? 0)
                  )
                    continue;
                  // First admission: rows another account left behind never project.
                  if (!admitted.has(scope)) next.set(scope, EMPTY_REPLICA);
                  admitted.add(scope);
                  // A later page may legitimately regrant a scope removed earlier in
                  // this chain; its fresh data must not inherit the cleanup job.
                  cleanup.delete(scope);
                  let replica = current(scope);
                  for (const input of list)
                    replica = mergeReplica(replica, input, modules.windowed);
                  next.set(scope, replica);
                }
                for (const [scope, replica] of next)
                  writeReplica(tx, scope, held.get(scope)!, replica);
                kv.put([...cleanup], `cleanupScopes:${user}`);
                kv.put([...admitted], `scopes:${user}`);
                // Until the whole pull commits, scopes sit at different revisions.
                // The durable marker keeps the cache "not ready" across a reload.
                if (stage === "partial") kv.put(true, `partialSync:${user}`);
                else {
                  if (stage === "pull") kv.delete(`partialSync:${user}`);
                  kv.put(this.now(), `lastSync:${user}`);
                }
              }),
            );
        }),
      );
      await this.refresh();
      await this.drainGone(generation);
    });
  }
  /** Called while holding the write gate; cleanup is idempotent and markers survive failure. */
  private async drainGone(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    const { db, user } = this.options;
    const key = `cleanupScopes:${user}`;
    const [pending, admitted] = await db
      .table<readonly string[], string>("kv")
      .getMany([key, `scopes:${user}`]);
    for (const scope of pending ?? []) {
      if (generation !== this.generation) return;
      if (!(admitted ?? []).includes(scope))
        await this.options.onGone?.([scope]);
      if (generation !== this.generation) return;
      await db.tx(["kv"], "readwrite", (tx) => {
        const table = tx.table<readonly string[], string>("kv");
        return table.get(key).then((latest) => {
          if (generation !== this.generation) return;
          return table.put(
            (latest ?? []).filter((item) => item !== scope),
            key,
          );
        });
      });
    }
  }
  /** Merges a fetched window page, or rows read individually, into an admitted scope. */
  async loadRows(scope: string, input: WindowInput): Promise<void> {
    await this.writes.run(async () => {
      const { db, user, modules } = this.options;
      await this.locks.run([scope], () =>
        db.tx(["rows", "scopes", "kv"], "readwrite", (tx) =>
          tx
            .table<readonly string[], string>("kv")
            .get(`scopes:${user}`)
            .then((admitted) => {
              if (!(admitted ?? []).includes(scope))
                throw new AppError("E_DENIED", "对话访问权限已失效");
              return readReplicas(tx, [scope], (held) => {
                const before = held.get(scope)!;
                writeReplica(
                  tx,
                  scope,
                  before,
                  mergeReplica(before.replica, input, modules.windowed),
                );
              });
            }),
        ),
      );
      await this.refresh();
    });
    // Pushes carry windowed rows only for scopes that held a window at the last
    // pull. Until the next pull lists this one, its window can only go stale.
    if (
      this.online &&
      !this.pushesWindowed.has(scope) &&
      holdsWindow(this.snapshot.coverage[scope])
    )
      void this.pull().catch((error: unknown) => this.options.onError?.(error));
  }
  /** Sequence numbers in lo..hi of a windowed type that are not known to be current. */
  holes(scope: string, type: string, lo: number, hi: number): IntervalSetJSON {
    return holes(this.snapshot.coverage[scope] ?? EMPTY_COVERAGE, type, lo, hi);
  }
  private flushInBackground(): void {
    void this.flush().catch((error: unknown) => this.options.onError?.(error));
  }
  async flush(): Promise<void> {
    if (
      this.retryBlocked ||
      this.pullRetryTimer !== undefined ||
      this.needsPull
    )
      return;
    if (this.flushing) {
      await this.flushing;
      if (
        this.online &&
        !this.retryBlocked &&
        nextToSend(this.snapshot.outbox, this.sendOptions, this.now()).length
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
  /** Wakes the flusher when the earliest debounced write becomes due. */
  private scheduleDebounced(now: number): void {
    this.timers.clear(this.debounceTimer);
    this.debounceTimer = undefined;
    const due = this.snapshot.outbox.reduce(
      (earliest, item) =>
        item.state === "pending" &&
        item.notBefore !== undefined &&
        item.notBefore > now
          ? Math.min(earliest, item.notBefore)
          : earliest,
      Infinity,
    );
    if (!this.online || !Number.isFinite(due)) return;
    this.debounceTimer = this.timers.set(() => {
      this.debounceTimer = undefined;
      this.flushInBackground();
    }, due - now);
  }
  /** One request per flush step: independent heads and register writes travel together. */
  private batch(eligible: readonly OutboxItem[]): readonly OutboxItem[] {
    const batch: OutboxItem[] = [];
    let bytes = 0;
    for (const item of eligible) {
      const size = JSON.stringify(item.args ?? null).length + item.op.length;
      if (batch.length && bytes + size > BATCH_BYTES) break;
      batch.push(item);
      bytes += size;
    }
    return batch;
  }
  /** Per-operation outcome; a whole-request failure applies to every operation. */
  private async send(
    batch: readonly OutboxItem[],
  ): Promise<Map<string, AppError | undefined>> {
    const outcomes = new Map<string, AppError | undefined>();
    const failure = (cause: unknown): AppError =>
      cause instanceof AppError
        ? cause
        : new AppError("E_DISCONNECTED", "连接已断开");
    if (batch.length === 1) {
      const item = batch[0]!;
      const method = methodRegistry[item.method];
      try {
        if (!method) throw new AppError("E_INVALID", "未知的排队操作");
        await this.options.call(method, item.args, { op: item.op });
        outcomes.set(item.op, undefined);
      } catch (cause) {
        outcomes.set(item.op, failure(cause));
      }
      return outcomes;
    }
    try {
      const { results } = await this.options.call(contract.sync.push, {
        ops: batch.map((item) => ({
          op: item.op,
          method: item.method,
          args: item.args as JsonValue,
        })),
      });
      const byOp = new Map(results.map((result) => [result.op, result]));
      for (const item of batch) {
        const result = byOp.get(item.op);
        outcomes.set(
          item.op,
          !result
            ? new AppError("E_PROTOCOL", "服务器响应无效")
            : result.error
              ? new AppError(
                  result.error.code,
                  result.error.message,
                  result.error.data,
                )
              : undefined,
        );
      }
    } catch (cause) {
      const error = failure(cause);
      for (const item of batch) outcomes.set(item.op, error);
    }
    return outcomes;
  }
  private async runFlush(): Promise<void> {
    while (
      this.online &&
      !this.needsPull &&
      !this.retryBlocked &&
      this.pullRetryTimer === undefined
    ) {
      const now = this.now();
      const batch = this.batch(
        nextToSend(this.snapshot.outbox, this.sendOptions, now),
      );
      if (!batch.length) {
        this.scheduleDebounced(now);
        return;
      }
      const generation = this.generation;
      const lost = async (): Promise<boolean> => {
        if (this.online && generation === this.generation) return false;
        await this.change({ type: "connectionLost" });
        return true;
      };
      await this.change(
        batch.map((item) => ({ type: "sendStarted" as const, op: item.op })),
        generation,
      );
      if (await lost()) return;
      const outcomes = await this.send(batch);
      if (await lost()) return;
      const paused = [...outcomes.values()].find(
        (error) => error && this.pausesSync(error),
      );
      if (paused) {
        this.disconnect();
        await this.change({ type: "connectionLost" });
        this.options.onError?.(paused);
        return;
      }
      const accepted = batch.filter((item) => !outcomes.get(item.op));
      const events: OutboxEvent[] = [];
      let retry = false;
      let terminal = false;
      for (const item of batch) {
        const error = outcomes.get(item.op);
        if (!error) continue;
        if (isTerminalRejection(error.code)) terminal = true;
        else retry = true;
        events.push({
          type: isTerminalRejection(error.code)
            ? "rejected"
            : "transportFailed",
          op: item.op,
          error: error.toJSON(),
        });
      }
      if (events.length) await this.change(events, generation);
      if (await lost()) return;
      if (accepted.length || terminal) {
        // Authoritative pull precedes removal of the optimistic layer, including
        // duplicate acks, and rolls back rejected writes.
        let pulled = true;
        let readError = new AppError("E_DISCONNECTED", "连接已断开");
        try {
          await this.pull();
        } catch (error) {
          pulled = false;
          if (error instanceof AppError) readError = error;
          if (!accepted.length) {
            this.options.onError?.(error);
            return;
          }
        }
        if (await lost()) return;
        // A confirmed write followed by a failed read is still accepted by the server.
        // Keep its idempotency key/optimistic layer and retry reconciliation, never reject it.
        await this.change(
          accepted.map((item): OutboxEvent =>
            pulled
              ? { type: "acked", op: item.op }
              : {
                  type: "transportFailed",
                  op: item.op,
                  error: readError.toJSON(),
                },
          ),
          generation,
        );
        if (await lost()) return;
        retry = retry || !pulled;
      }
      if (retry) {
        if (this.online) {
          this.timers.clear(this.retryTimer);
          this.retryBlocked = true;
          this.retryTimer = this.timers.set(
            () => {
              this.retryBlocked = false;
              this.flushInBackground();
            },
            Math.max(
              500,
              ...batch.map(
                (item) =>
                  this.snapshot.outbox.find((op) => op.op === item.op)
                    ?.retryAfterMs ?? 0,
              ),
            ),
          );
        }
        return;
      }
    }
  }
  close(): void {
    this.disconnect();
    this.events.clear();
  }
}
