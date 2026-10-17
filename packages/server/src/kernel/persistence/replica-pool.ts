import { Worker } from "node:worker_threads";
import { AppError } from "@talos/base";
import type { RawQueryStats } from "./query-stats.ts";

/**
 * Worker threads that each hold a read-only SQLite connection to the WAL
 * database. The writer stays on the main thread; replicas only answer read
 * tasks, each inside one read transaction (a consistent snapshot that already
 * contains every commit made before the task was sent). A failed or missing
 * replica rejects with `E_UNAVAILABLE` so callers can compute locally.
 */
export interface ReplicaPoolOptions {
  /** Module the workers run; it must call `serveReplica` when loaded in a worker. */
  entry: string | URL;
  /** `entry` is module source evaluated as the worker (development loaders). */
  evalEntry?: boolean;
  size: number;
  workerData: unknown;
  execArgv?: string[];
  /** A task running longer is abandoned and its worker replaced. */
  timeoutMs?: number;
  reportError?(error: unknown): void;
}
export interface ReplicaStatus {
  size: number;
  ready: number;
  busy: number;
  completed: number;
  failed: number;
  restarts: number;
}
export interface ReplicaRequest {
  id: number;
  kind: string;
  input: unknown;
}
export type ReplicaReply =
  | { type: "ready" }
  | { type: "reply"; id: number; ok: true; value: unknown }
  | {
      type: "reply";
      id: number;
      ok: false;
      error: { code: string; message: string; data?: unknown };
      stack?: string;
    };

interface Pending {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}
interface Slot {
  worker: Worker;
  ready: boolean;
  pending: Map<number, Pending>;
}

const STATS = "replica.stats";
const RESET = "replica.reset";

export class ReplicaPool {
  private readonly slots: (Slot | undefined)[];
  private nextId = 1;
  private closed = false;
  private completed = 0;
  private failed = 0;
  private restarts = 0;
  constructor(private readonly options: ReplicaPoolOptions) {
    if (!Number.isSafeInteger(options.size) || options.size < 1)
      throw new AppError("E_INVALID", "只读连接数量无效");
    this.slots = Array.from({ length: options.size }, () => undefined);
    for (let index = 0; index < options.size; index++) this.spawn(index, 0);
  }
  /** Resolves once every replica answered (or failed) its start-up. */
  async ready(timeoutMs = 30_000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !this.closed) {
      const live = this.slots.filter(Boolean) as Slot[];
      if (live.length && live.every((slot) => slot.ready)) break;
      if (!live.length) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return this.status().ready;
  }
  run<T>(kind: string, input: unknown): Promise<T> {
    const slot = this.pick();
    if (!slot)
      return Promise.reject(new AppError("E_UNAVAILABLE", "只读连接不可用"));
    return this.send<T>(slot, kind, input);
  }
  /** Raw statement statistics of every ready replica. */
  async stats(): Promise<RawQueryStats[]> {
    const live = this.slots.filter((slot): slot is Slot => !!slot?.ready);
    const results = await Promise.allSettled(
      live.map((slot) => this.send<RawQueryStats>(slot, STATS, null)),
    );
    return results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
  }
  async reset(): Promise<void> {
    const live = this.slots.filter((slot): slot is Slot => !!slot?.ready);
    await Promise.allSettled(live.map((slot) => this.send(slot, RESET, null)));
  }
  status(): ReplicaStatus {
    let ready = 0,
      busy = 0;
    for (const slot of this.slots) {
      if (slot?.ready) ready++;
      if (slot?.pending.size) busy++;
    }
    return {
      size: this.options.size,
      ready,
      busy,
      completed: this.completed,
      failed: this.failed,
      restarts: this.restarts,
    };
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const slots = this.slots.splice(0) as (Slot | undefined)[];
    await Promise.all(
      slots.map(async (slot) => {
        if (!slot) return;
        this.fail(slot, new AppError("E_UNAVAILABLE", "只读连接已关闭"));
        await slot.worker.terminate();
      }),
    );
  }

  private pick(): Slot | undefined {
    let best: Slot | undefined;
    for (const slot of this.slots)
      if (slot?.ready && (!best || slot.pending.size < best.pending.size))
        best = slot;
    return best;
  }
  private send<T>(slot: Slot, kind: string, input: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        // A stuck read holds a WAL snapshot; replace the worker entirely.
        this.replace(slot, new AppError("E_TIMEOUT", "只读查询超时"));
      }, this.options.timeoutMs ?? 60_000);
      timer.unref?.();
      slot.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      try {
        slot.worker.postMessage({ id, kind, input } satisfies ReplicaRequest);
      } catch (error) {
        clearTimeout(timer);
        slot.pending.delete(id);
        reject(error);
      }
    });
  }
  private spawn(index: number, attempt: number): void {
    if (this.closed) return;
    let worker: Worker;
    try {
      worker = new Worker(this.options.entry, {
        ...(this.options.evalEntry ? { eval: true } : {}),
        workerData: this.options.workerData,
        ...(this.options.execArgv ? { execArgv: this.options.execArgv } : {}),
      });
    } catch (error) {
      this.report(error);
      return;
    }
    const slot: Slot = { worker, ready: false, pending: new Map() };
    this.slots[index] = slot;
    worker.unref();
    worker.on("message", (message: ReplicaReply) => {
      if (message.type === "ready") {
        slot.ready = true;
        return;
      }
      const pending = slot.pending.get(message.id);
      if (!pending) return;
      slot.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) {
        this.completed++;
        pending.resolve(message.value);
      } else {
        this.failed++;
        if (message.stack) {
          const fault = new Error("replica");
          fault.name = "ReplicaError";
          fault.stack = `ReplicaError\n${message.stack}`;
          this.report(fault);
        }
        pending.reject(
          new AppError(
            message.error.code as never,
            message.error.message,
            message.error.data,
          ),
        );
      }
    });
    const lost = (error: unknown) => {
      if (this.slots[index] !== slot) return;
      this.slots[index] = undefined;
      this.fail(slot, new AppError("E_UNAVAILABLE", "只读连接已退出"));
      if (error) this.report(error);
      if (this.closed) return;
      // Back off so a replica that cannot start does not spin.
      const delay = Math.min(30_000, 250 * 2 ** Math.min(attempt, 7));
      this.restarts++;
      setTimeout(
        () => this.spawn(index, slot.ready ? 0 : attempt + 1),
        delay,
      ).unref?.();
    };
    worker.on("error", lost);
    worker.on("exit", (code) => {
      lost(
        code === 0 || this.closed
          ? undefined
          : new AppError("E_INTERNAL", "只读连接异常退出"),
      );
    });
  }
  private replace(slot: Slot, error: unknown): void {
    this.fail(slot, error);
    void slot.worker.terminate();
  }
  private fail(slot: Slot, error: unknown): void {
    for (const pending of slot.pending.values()) {
      clearTimeout(pending.timer);
      this.failed++;
      pending.reject(error);
    }
    slot.pending.clear();
  }
  private report(error: unknown): void {
    try {
      this.options.reportError?.(error);
    } catch {
      /* Reporting never breaks the pool. */
    }
  }
}
