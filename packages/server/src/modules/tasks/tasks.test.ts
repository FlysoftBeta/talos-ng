import { afterEach, describe, expect, it } from "vitest";
import { AppError, createUlid, deferred } from "@talos/base";
import { contract } from "@talos/contract";
import { Db } from "../../kernel/persistence/db.ts";
import { Jobs } from "../../kernel/jobs/jobs.ts";
import { SyncHub } from "../../kernel/sync/sync-hub.ts";
import { Uow } from "../../kernel/persistence/uow.ts";
import { createTasks } from "./index.ts";
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function settle(): Promise<void> {
  for (let i = 0; i < 25; i++) await Promise.resolve();
}
function setup() {
  const db = new Db();
  let now = 1000;
  const hub = new SyncHub({ revision: () => uow.revision });
  const uow = new Uow(db, hub);
  const jobs = new Jobs({
    db,
    uow,
    clock: () => now,
    id: createUlid(),
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
  });
  const tasks = createTasks({ jobs, syncHub: hub });
  cleanup.push(() => {
    jobs.close();
    db.close();
  });
  return {
    jobs,
    tasks,
    hub,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
describe("task projection", () => {
  it("retries only explicitly safe kinds and preserves attempts", async () => {
    const f = setup();
    let runs = 0;
    f.jobs.register("safe", {
      concurrency: 1,
      timeoutMs: 1000,
      onBoot: "requeue",
      retryable: true,
      run: () => {
        if (++runs === 1) throw new AppError("E_UNAVAILABLE", "稍后重试");
        return "ok";
      },
    });
    const job = f.jobs.enqueue("owner", "safe", {});
    expect(() => f.tasks.retry("owner", job.id)).toThrow(
      expect.objectContaining({ code: "E_CONFLICT" }),
    );
    f.jobs.start();
    await settle();
    expect(f.jobs.get(job.id)?.state).toBe("failed");
    expect(() => f.tasks.retry("other", job.id)).toThrow(
      expect.objectContaining({ code: "E_DENIED" }),
    );
    f.tasks.retry("owner", job.id);
    await settle();
    expect(f.jobs.get(job.id)).toMatchObject({
      state: "done",
      attempts: 2,
      error: null,
      result: "ok",
    });
  });
  it("refuses retries for nonrepeatable kinds, missing rows, deleted rows and running cancellation cleanup", async () => {
    const f = setup();
    const blocked = deferred<void>();
    f.jobs.register("once", {
      concurrency: 1,
      timeoutMs: 1000,
      onBoot: "fail",
      run: () => {
        throw new AppError("E_INVALID", "不能重试");
      },
    });
    f.jobs.register("safe", {
      concurrency: 1,
      timeoutMs: 1000,
      onBoot: "requeue",
      retryable: true,
      run: () => blocked.promise,
    });
    const once = f.jobs.enqueue("u", "once", {}),
      safe = f.jobs.enqueue("u", "safe", {});
    f.jobs.start();
    await settle();
    expect(() => f.tasks.retry("u", once.id)).toThrow(
      expect.objectContaining({ code: "E_DENIED" }),
    );
    expect(() => f.tasks.retry("u", "missing")).toThrow(
      expect.objectContaining({ code: "E_NOT_FOUND" }),
    );
    f.tasks.cancel("u", safe.id);
    expect(() => f.tasks.retry("u", safe.id)).toThrow(
      expect.objectContaining({ code: "E_CONFLICT" }),
    );
    blocked.resolve();
    await settle();
    f.tasks.clear("u", safe.id);
    expect(() => f.tasks.retry("u", safe.id)).toThrow(
      expect.objectContaining({ code: "E_NOT_FOUND" }),
    );
  });
  it("clears only older terminal history, keeping newest 100 and every active row", async () => {
    const f = setup();
    f.jobs.register("safe", {
      concurrency: 110,
      timeoutMs: 1000,
      onBoot: "requeue",
      run: () => null,
    });
    const ids = Array.from(
      { length: 105 },
      () => f.jobs.enqueue("u", "safe", {}).id,
    );
    f.jobs.start();
    await settle();
    const active = f.jobs.enqueue("u", "safe", {}, { runAfter: 50000 });
    const other = f.jobs.enqueue("v", "safe", {}, { runAfter: 50000 });
    f.tasks.clear("u");
    expect(ids.filter((id) => !f.jobs.get(id)?.deleted)).toHaveLength(100);
    expect(ids.slice(0, 5).every((id) => f.jobs.get(id)?.deleted)).toBe(true);
    expect(f.jobs.get(active.id)?.deleted).toBe(false);
    expect(f.jobs.get(other.id)?.deleted).toBe(false);
    expect(f.tasks.repo.read("me:v", ids[0]!)).toBeUndefined();
  });
  it("projects validated progress, ETA excluding queue time, and no private payload", async () => {
    const f = setup();
    const blocked = deferred<void>();
    let progress: (n: number) => void = () => {};
    f.jobs.register("safe", {
      concurrency: 1,
      timeoutMs: 1000,
      onBoot: "requeue",
      retryable: true,
      run: (ctx) => {
        progress = ctx.progress;
        return blocked.promise;
      },
    });
    const owner = createUlid()();
    const job = f.jobs.enqueue(owner, "safe", { secret: "never sent" });
    f.advance(10000);
    f.jobs.start();
    await settle();
    f.advance(1000);
    progress(0.25);
    const data = f.tasks.repo.read(`me:${owner}`, job.id)!.data;
    expect(contract.tasks.job.schema.safeParse(data).success).toBe(true);
    expect(data).toMatchObject({
      progress: 0.25,
      etaMs: 3000,
      retryable: true,
    });
    expect(data).not.toHaveProperty("payload");
    blocked.resolve();
    await settle();
    expect(f.tasks.repo.read(`me:${owner}`, job.id)!.data).toMatchObject({
      etaMs: null,
    });
  });
});
