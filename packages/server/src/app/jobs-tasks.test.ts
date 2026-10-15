import { afterEach, describe, expect, it } from "vitest";
import { AppError, createUlid, deferred } from "@talos/base";
import { contract } from "@talos/contract";
import { Db } from "../kernel/persistence/db.ts";
import { Uow } from "../kernel/persistence/uow.ts";
import { Jobs } from "../kernel/jobs/jobs.ts";
import type { JobContext, JobKind, JobTimers } from "../kernel/jobs/jobs.ts";
import { SyncHub } from "../kernel/sync/sync-hub.ts";
import { createTasks } from "../modules/tasks/index.ts";
import type { SyncResponse } from "../kernel/sync/sync-hub.ts";

class Timers implements JobTimers {
  now = 1000;
  private next = 0;
  private readonly pending = new Map<
    number,
    { at: number; callback: () => void }
  >();
  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = ++this.next;
    this.pending.set(id, { at: this.now + delayMs, callback });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }
  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      const next = [...this.pending]
        .filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.now = next[1].at;
      this.pending.delete(next[0]);
      next[1].callback();
    }
    this.now = until;
  }
  get size(): number {
    return this.pending.size;
  }
}
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
async function settle(): Promise<void> {
  for (let n = 0; n < 20; n++) await Promise.resolve();
}
function fixture() {
  const db = new Db();
  const timers = new Timers();
  const errors: unknown[] = [];
  const hub = new SyncHub({ revision: () => uow.revision });
  const uow = new Uow(db, hub);
  const options = {
    db,
    uow,
    clock: () => timers.now,
    timers,
    id: createUlid({ clock: () => timers.now, random: () => 0.5 }),
    reportError: (error: unknown) => {
      errors.push(error);
    },
  };
  const jobs = new Jobs(options);
  const tasks = createTasks({ jobs, syncHub: hub, dev: true, timers });
  cleanups.push(() => {
    jobs.close();
    db.close();
  });
  return { db, timers, hub, uow, jobs, tasks, errors, options };
}
function kind(run: JobKind["run"], options: Partial<JobKind> = {}): JobKind {
  return {
    concurrency: 1,
    timeoutMs: 1000,
    onBoot: "requeue",
    run,
    ...options,
  };
}

describe("durable Jobs", () => {
  it("persists enqueue, execution and completion as owner-scoped changes", async () => {
    const f = fixture();
    const events: SyncResponse[] = [];
    f.hub.pull(
      "u",
      { cursors: {} },
      {
        id: "connection",
        emit: (_topic, data) => events.push(data as SyncResponse),
      },
    );
    f.jobs.register(
      "echo",
      kind((context) => context.payload),
    );
    f.jobs.start();
    const job = f.jobs.enqueue("u", "echo", { answer: 42 });
    await settle();
    expect(f.jobs.get(job.id)).toMatchObject({
      state: "done",
      attempts: 1,
      result: { answer: 42 },
      progress: 1,
    });
    const rows = events.flatMap((event) => event.scopes["me:u"]?.rows ?? []);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => (row.data as { state: string }).state)).toEqual([
      "queued",
      "running",
      "done",
    ]);
    const data = rows[2]!.data as Record<string, unknown>;
    expect(data).not.toHaveProperty("payload");
    expect(data).not.toHaveProperty("runAfter");
    // Contract IDs are ULIDs; the test's actor is replaced with a canonical ID.
    expect(
      contract.tasks.job.schema.safeParse({ ...data, owner: job.id }).success,
    ).toBe(true);
  });
  it("enforces independent per-kind concurrency", async () => {
    const f = fixture();
    const first = deferred<unknown>();
    const started: string[] = [];
    f.jobs.register(
      "one",
      kind((context) => {
        started.push(context.id);
        return first.promise;
      }),
    );
    f.jobs.register(
      "two",
      kind(() => "independent"),
    );
    const a = f.jobs.enqueue("u", "one", null);
    const b = f.jobs.enqueue("u", "one", null);
    const c = f.jobs.enqueue("u", "two", null);
    f.jobs.start();
    await settle();
    expect(started).toEqual([a.id]);
    expect(f.jobs.get(b.id)?.state).toBe("queued");
    expect(f.jobs.get(c.id)?.state).toBe("done");
    first.resolve(null);
    await settle();
    expect(started).toEqual([a.id, b.id]);
    expect(f.jobs.get(b.id)?.state).toBe("done");
  });
  it("uses an injected timer for scheduled runs", async () => {
    const f = fixture();
    f.jobs.register(
      "later",
      kind(() => null),
    );
    f.jobs.start();
    const job = f.jobs.enqueue("u", "later", null, { runAfter: 1500 });
    await settle();
    f.timers.advance(499);
    await settle();
    expect(f.jobs.get(job.id)?.state).toBe("queued");
    f.timers.advance(1);
    await settle();
    expect(f.jobs.get(job.id)?.state).toBe("done");
  });
  it("throttles progress with a trailing update and emits completion immediately", async () => {
    const f = fixture();
    const done = deferred<unknown>();
    let context!: JobContext;
    f.jobs.register(
      "progress",
      kind((ctx) => {
        context = ctx;
        return done.promise;
      }),
    );
    f.jobs.start();
    const job = f.jobs.enqueue("u", "progress", null);
    await settle();
    context.progress(0.1, "first");
    const revision = f.uow.revision;
    context.progress(0.2);
    context.progress(0.3, "latest");
    expect(f.jobs.get(job.id)?.progress).toBe(0.1);
    expect(f.uow.revision).toBe(revision);
    f.timers.advance(249);
    expect(f.jobs.get(job.id)?.progress).toBe(0.1);
    f.timers.advance(1);
    expect(f.jobs.get(job.id)).toMatchObject({
      progress: 0.3,
      message: "latest",
    });
    context.progress(0.8);
    done.resolve("done");
    await settle();
    expect(f.jobs.get(job.id)).toMatchObject({ state: "done", progress: 1 });
    expect(f.timers.size).toBe(0);
  });
  it("cancels queued and running jobs without accepting a late successful result", async () => {
    const f = fixture();
    const done = deferred<unknown>();
    let context!: JobContext;
    f.jobs.register(
      "cancel",
      kind((ctx) => {
        context = ctx;
        return done.promise;
      }),
    );
    const queued = f.jobs.enqueue("u", "cancel", null);
    f.jobs.cancel("u", queued.id);
    f.jobs.start();
    const running = f.jobs.enqueue("u", "cancel", null);
    await settle();
    f.jobs.cancel("u", running.id);
    expect(context.signal.aborted).toBe(true);
    done.resolve("late");
    await settle();
    expect(f.jobs.get(queued.id)?.state).toBe("cancelled");
    expect(f.jobs.get(running.id)?.state).toBe("cancelled");
    expect(f.jobs.get(running.id)?.result).toBeNull();
  });
  it("timeouts abort but retain the concurrency slot until an uncooperative run settles", async () => {
    const f = fixture();
    const done = deferred<unknown>();
    let context!: JobContext;
    f.jobs.register(
      "timeout",
      kind(
        (ctx) => {
          context = ctx;
          return done.promise;
        },
        { timeoutMs: 100 },
      ),
    );
    f.jobs.start();
    const first = f.jobs.enqueue("u", "timeout", null);
    const second = f.jobs.enqueue("u", "timeout", null);
    await settle();
    f.timers.advance(100);
    await settle();
    expect(context.signal.aborted).toBe(true);
    expect(f.jobs.get(first.id)).toMatchObject({
      state: "failed",
      error: { code: "E_TIMEOUT" },
    });
    expect(f.jobs.get(second.id)?.state).toBe("queued");
    done.resolve(null);
    await settle();
    expect(f.jobs.get(second.id)?.state).toBe("done");
  });
  it("requeues or fails interrupted running jobs according to boot policy", async () => {
    const f = fixture();
    const pending = deferred<unknown>();
    f.jobs.register(
      "resume",
      kind(() => pending.promise),
    );
    f.jobs.register(
      "fail",
      kind(() => pending.promise, { onBoot: "fail" }),
    );
    f.jobs.start();
    const resumed = f.jobs.enqueue("u", "resume", null);
    const failed = f.jobs.enqueue("u", "fail", null);
    await settle();
    f.jobs.close();
    const restarted = new Jobs(f.options);
    restarted.register(
      "resume",
      kind(() => "recovered"),
    );
    restarted.register(
      "fail",
      kind(() => "wrong", { onBoot: "fail" }),
    );
    restarted.start();
    await settle();
    expect(restarted.get(resumed.id)).toMatchObject({
      state: "done",
      attempts: 2,
      result: "recovered",
    });
    expect(restarted.get(failed.id)).toMatchObject({
      state: "failed",
      error: { code: "E_UNAVAILABLE" },
    });
    restarted.close();
    pending.resolve(null);
    await settle();
  });
  it("retains failed-job diagnostics without exposing unknown error messages", async () => {
    const f = fixture();
    f.jobs.register(
      "bad",
      kind(() => {
        throw new Error("private credential");
      }),
    );
    f.jobs.start();
    const job = f.jobs.enqueue("u", "bad", null);
    await settle();
    expect(f.jobs.get(job.id)?.error).toEqual({
      code: "E_INTERNAL",
      message: "任务执行失败，请稍后重试",
    });
    expect(f.errors).toHaveLength(1);
  });
  it("marks invalid completion data failed instead of leaving the row running", async () => {
    const f = fixture();
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    f.jobs.register(
      "cyclic",
      kind(() => cyclic),
    );
    f.jobs.start();
    const job = f.jobs.enqueue("u", "cyclic", null);
    await settle();
    expect(f.jobs.get(job.id)).toMatchObject({
      state: "failed",
      error: { code: "E_INTERNAL" },
    });
  });
  it("clears terminal rows with a tombstone and enforces owner checks", async () => {
    const f = fixture();
    f.jobs.register(
      "job",
      kind(() => null),
    );
    const queued = f.jobs.enqueue("u", "job", null);
    expect(() => f.jobs.clear("u", queued.id)).toThrow(AppError);
    expect(() => f.jobs.cancel("other", queued.id)).toThrow("其他用户");
    f.jobs.cancel("u", queued.id);
    f.jobs.clear("u", queued.id);
    const synced = f.hub.pull("u", { cursors: {} }).scopes["me:u"]!.rows[0]!;
    expect(synced.deleted).toBe(true);
    expect(synced.data).toBeNull();
    expect(() => f.jobs.cancel("u", queued.id)).toThrow("不存在");
  });
  it("does not publish or execute jobs when the outer unit of work rolls back", async () => {
    const f = fixture();
    let executions = 0;
    f.jobs.register(
      "job",
      kind(() => {
        executions++;
      }),
    );
    f.jobs.start();
    expect(() =>
      f.uow.write(() => {
        f.jobs.enqueue("u", "job", null);
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    await settle();
    expect(f.jobs.list("u")).toHaveLength(0);
    expect(executions).toBe(0);
    expect(f.uow.revision).toBe(0);
  });
  it("does not abort an active worker when cancellation is rolled back", async () => {
    const f = fixture();
    const done = deferred<unknown>();
    let context!: JobContext;
    f.jobs.register(
      "job",
      kind((ctx) => {
        context = ctx;
        return done.promise;
      }),
    );
    f.jobs.start();
    const job = f.jobs.enqueue("u", "job", null);
    await settle();
    expect(() =>
      f.uow.write(() => {
        f.jobs.cancel("u", job.id);
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    expect(context.signal.aborted).toBe(false);
    expect(f.jobs.get(job.id)?.state).toBe("running");
    done.resolve(null);
    await settle();
    expect(f.jobs.get(job.id)?.state).toBe("done");
  });
  it("close aborts runs and preserves their running rows for recovery", async () => {
    const f = fixture();
    const pending = deferred<unknown>();
    let context!: JobContext;
    f.jobs.register(
      "job",
      kind((ctx) => {
        context = ctx;
        return pending.promise;
      }),
    );
    f.jobs.start();
    const job = f.jobs.enqueue("u", "job", null);
    await settle();
    f.jobs.close();
    expect(context.signal.aborted).toBe(true);
    pending.resolve("late");
    await settle();
    expect(f.jobs.get(job.id)?.state).toBe("running");
    expect(f.timers.size).toBe(0);
    expect(() => f.jobs.enqueue("u", "job", null)).toThrow("已关闭");
  });
  it("runs the dev-only debug.sleep kind without real sleeping and clears terminal tasks", async () => {
    const f = fixture();
    f.jobs.start();
    const job = f.jobs.enqueue("u", "debug.sleep", { ms: 1000, steps: 4 });
    await settle();
    f.timers.advance(250);
    expect(f.jobs.get(job.id)?.progress).toBe(0.25);
    f.timers.advance(750);
    await settle();
    expect(f.jobs.get(job.id)).toMatchObject({
      state: "done",
      result: { sleptMs: 1000 },
    });
    f.tasks.clear("u");
    expect(f.jobs.get(job.id)?.deleted).toBe(false);
    f.tasks.clear("u", job.id);
    expect(f.jobs.get(job.id)?.deleted).toBe(true);
  });
  it("rejects invalid definitions, schedules, progress and payloads", async () => {
    const f = fixture();
    expect(() =>
      f.jobs.register(
        "bad",
        kind(() => null, { concurrency: 0 }),
      ),
    ).toThrow();
    expect(() => f.jobs.enqueue("u", "missing", null)).toThrow("不存在");
    f.jobs.register(
      "job",
      kind((ctx) => {
        ctx.progress(2);
      }),
    );
    expect(() =>
      f.jobs.register(
        "job",
        kind(() => null),
      ),
    ).toThrow("已注册");
    expect(() => f.jobs.enqueue("u", "job", undefined)).toThrow("JSON");
    expect(() => f.jobs.enqueue("u", "job", null, { runAfter: -1 })).toThrow(
      "执行时间",
    );
    f.jobs.start();
    expect(() =>
      f.jobs.register(
        "late",
        kind(() => null),
      ),
    ).toThrow("启动任务服务前");
    const job = f.jobs.enqueue("u", "job", null);
    await settle();
    expect(f.jobs.get(job.id)).toMatchObject({
      state: "failed",
      error: { code: "E_INVALID" },
    });
  });
});

it("waits for asynchronous abort cleanup before owner purge can proceed", async () => {
  const f = fixture();
  const cleanup = deferred<void>();
  let aborted = false,
    cleaned = false;
  f.jobs.register("purge.cleanup", {
    concurrency: 1,
    timeoutMs: 30000,
    onBoot: "fail",
    run: async (ctx) => {
      ctx.signal.addEventListener("abort", () => {
        aborted = true;
      });
      await cleanup.promise;
      cleaned = true;
    },
  });
  f.jobs.start();
  f.jobs.enqueue("alice", "purge.cleanup", {});
  await settle();
  let completed = false;
  const purge = f.jobs.cancelOwner("alice").then(() => {
    completed = true;
  });
  await settle();
  expect(aborted).toBe(true);
  expect(completed).toBe(false);
  cleanup.resolve();
  await purge;
  expect(cleaned).toBe(true);
});
