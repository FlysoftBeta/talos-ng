import { afterEach, expect, it, vi } from "vitest";
import { createMemoryCarrierPair } from "./memory.ts";
afterEach(() => vi.useRealTimers());
it("memory carrier manually delivers/drops copies and reports buffer/listener counts", () => {
  const pair = createMemoryCarrierPair({ manual: true });
  const received = vi.fn();
  const off = pair.b.onMessage(received);
  const bytes = new Uint8Array([1, 2]);
  pair.a.send(bytes);
  bytes[0] = 3;
  expect(pair.pending).toBe(1);
  expect(pair.a.bufferedAmount).toBe(2);
  expect(pair.deliver()).toBe(true);
  expect(received).toHaveBeenCalledWith(new Uint8Array([1, 2]));
  pair.a.send(bytes);
  expect(pair.drop()).toBe(true);
  expect(pair.drop()).toBe(false);
  expect(pair.deliver()).toBe(false);
  off();
  off();
  expect(pair.b.listenerCount).toBe(0);
  const close = vi.fn();
  pair.b.onClose(close);
  pair.close();
  pair.close();
  expect(close).toHaveBeenCalledOnce();
  expect(() => pair.a.send(bytes)).toThrow(
    expect.objectContaining({ code: "E_DISCONNECTED" }),
  );
});
it("memory carrier schedules latency with an injected clock and cancels pending delivery on loss", async () => {
  vi.useFakeTimers();
  const timers = {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: unknown) =>
      clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  const pair = createMemoryCarrierPair({ latencyMs: 25, clock: timers });
  const receive = vi.fn();
  pair.b.onMessage(receive);
  pair.a.send(new Uint8Array([1]));
  await vi.advanceTimersByTimeAsync(24);
  expect(receive).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(receive).toHaveBeenCalledOnce();
  pair.a.send(new Uint8Array([2]));
  pair.close();
  await vi.advanceTimersByTimeAsync(100);
  expect(receive).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("graceful endpoint close delivers accepted messages before close; pair.close simulates abrupt loss", () => {
  const pair = createMemoryCarrierPair({ manual: true });
  const events: string[] = [];
  pair.b.onMessage(() => events.push("message"));
  pair.b.onClose(() => events.push("close"));
  pair.a.send(new Uint8Array([1]));
  pair.a.close();
  expect(events).toEqual(["message", "close"]);
  const late = vi.fn();
  pair.a.onClose(late);
  expect(late).toHaveBeenCalledOnce();
});
