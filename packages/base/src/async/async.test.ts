import { afterEach, describe, expect, it, vi } from "vitest";
import { backoff } from "./backoff.ts";
import { deferred } from "./deferred.ts";
import { Semaphore } from "./semaphore.ts";
import { sleep } from "./sleep.ts";
afterEach(() => {
  vi.useRealTimers();
});
describe("async primitives", () => {
  it("settles deferred promises only once, including thenable assimilation", async () => {
    const d = deferred<number>();
    d.resolve(Promise.resolve(42));
    d.reject(new Error());
    expect(await d.promise).toBe(42);
    const failed = deferred<void>();
    const check = expect(failed.promise).rejects.toBe("failed");
    failed.reject("failed");
    await check;
  });
  it("hands permits to FIFO waiters and removes cancelled waiters", async () => {
    const s = new Semaphore(1);
    await s.acquire();
    const order: number[] = [];
    const controller = new AbortController();
    const one = s.acquire().then(() => {
      order.push(1);
    });
    const cancelled = s.acquire(controller.signal);
    const check = expect(cancelled).rejects.toMatchObject({
      code: "E_CANCELLED",
    });
    const three = s.acquire().then(() => {
      order.push(3);
    });
    controller.abort();
    await check;
    s.release();
    await one;
    expect(order).toEqual([1]);
    s.release();
    await three;
    expect(order).toEqual([1, 3]);
    s.release();
    expect(() => s.release()).toThrow();
  });
  it("limits concurrency and releases on success, synchronous throw, and rejection", async () => {
    const s = new Semaphore(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        s.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await Promise.resolve();
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
    await expect(
      s.run(() => {
        throw new Error("sync");
      }),
    ).rejects.toThrow("sync");
    await expect(
      s.run(() => Promise.reject(new Error("async"))),
    ).rejects.toThrow("async");
    expect(await s.run(() => 7)).toBe(7);
    for (const capacity of [0, -1, 0.5, Infinity])
      expect(() => new Semaphore(capacity)).toThrow();
  });
  it("rejects already-aborted signals and cleans acquisition listeners after handoff", async () => {
    const s = new Semaphore();
    const controller = new AbortController();
    controller.abort();
    await expect(s.acquire(controller.signal)).rejects.toMatchObject({
      code: "E_CANCELLED",
    });
    await s.acquire();
    const next = new AbortController();
    const remove = vi.spyOn(next.signal, "removeEventListener");
    const acquired = s.acquire(next.signal);
    s.release();
    await acquired;
    expect(remove).toHaveBeenCalledOnce();
    next.abort();
    s.release();
  });
  it("sleep resolves, cancels and removes timers/listeners", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const promise = sleep(20, controller.signal);
    await vi.advanceTimersByTimeAsync(20);
    await promise;
    expect(remove).toHaveBeenCalledOnce();
    const cancelled = sleep(100, controller.signal);
    const check = expect(cancelled).rejects.toMatchObject({
      code: "E_CANCELLED",
    });
    controller.abort();
    await check;
    expect(vi.getTimerCount()).toBe(0);
    await expect(sleep(0, controller.signal)).rejects.toMatchObject({
      code: "E_CANCELLED",
    });
    for (const invalid of [-1, Infinity, NaN, 2147483648])
      await expect(sleep(invalid)).rejects.toThrow(RangeError);
  });
  it("backoff doubles, caps, resets, validates and supports deterministic jitter", () => {
    const b = backoff({ baseMs: 500, maxMs: 10000, jitter: 0 });
    expect(Array.from({ length: 8 }, () => b.next())).toEqual([
      500, 1000, 2000, 4000, 8000, 10000, 10000, 10000,
    ]);
    b.reset();
    expect(b.next()).toBe(500);
    expect(
      backoff({ baseMs: 100, maxMs: 150, jitter: 0.5, random: () => 0 }).next(),
    ).toBe(50);
    const capped = backoff({
      baseMs: 100,
      maxMs: 150,
      jitter: 1,
      random: () => 0.99,
    });
    expect(capped.next()).toBe(150);
    expect(() => backoff({ baseMs: 0, maxMs: 1, jitter: 0 })).toThrow();
    expect(() => backoff({ baseMs: 1, maxMs: 0, jitter: 0 })).toThrow();
    expect(() => backoff({ baseMs: 1, maxMs: 2, jitter: 2 })).toThrow();
    expect(() =>
      backoff({ baseMs: 1, maxMs: 2, jitter: 1, random: () => 1 }).next(),
    ).toThrow();
  });
});
