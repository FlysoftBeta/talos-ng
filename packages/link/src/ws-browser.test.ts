import { expect, it, vi } from "vitest";
import {
  browserWebSocketCarrier,
  connectBrowserWebSocket,
} from "./ws-browser.ts";
import type { BrowserSocket } from "./ws-browser.ts";
class Socket implements BrowserSocket {
  binaryType = "blob";
  readyState = 0;
  bufferedAmount = 0;
  listeners = new Map<string, Set<(event: never) => void>>();
  sent: Uint8Array[] = [];
  send(bytes: Uint8Array): void {
    this.sent.push(bytes);
  }
  close(): void {
    this.readyState = 3;
    this.dispatch("close", { code: 1000, reason: "done" });
  }
  addEventListener(type: string, listener: (event: never) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }
  removeEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string, data?: unknown): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(data as never);
  }
  get listenerCount(): number {
    return [...this.listeners.values()].reduce((n, set) => n + set.size, 0);
  }
}
it("browser adapter uses arraybuffer, exposes binary messages and removes DOM listeners on close", () => {
  const socket = new Socket();
  socket.readyState = 1;
  const carrier = browserWebSocketCarrier(socket);
  expect(socket.binaryType).toBe("arraybuffer");
  const message = vi.fn();
  carrier.onMessage(message);
  const data = new Uint8Array([0, 255]);
  socket.dispatch("message", { data: data.buffer });
  expect(message).toHaveBeenCalledWith(data);
  carrier.send(data);
  expect(socket.sent).toEqual([data]);
  socket.bufferedAmount = 5;
  expect(carrier.bufferedAmount).toBe(5);
  const close = vi.fn();
  carrier.onClose(close);
  carrier.close();
  expect(close).toHaveBeenCalledOnce();
  expect(socket.listenerCount).toBe(0);
  expect(() => carrier.send(data)).toThrow(
    expect.objectContaining({ code: "E_DISCONNECTED" }),
  );
  const late = vi.fn();
  carrier.onClose(late);
  expect(late).toHaveBeenCalledOnce();
});
it("browser adapter rejects text frames and handles errors and already closed sockets", () => {
  for (const cause of ["message", "error", "closed"]) {
    const socket = new Socket();
    socket.readyState = cause === "closed" ? 3 : 1;
    const carrier = browserWebSocketCarrier(socket);
    const close = vi.fn();
    carrier.onClose(close);
    if (cause !== "closed") socket.dispatch(cause, { data: "text" });
    expect(close).toHaveBeenCalledOnce();
    expect(socket.listenerCount).toBe(0);
  }
});
it("browser connector resolves only at open and maps connection failures", async () => {
  const socket = new Socket();
  const connected = connectBrowserWebSocket("ws://test", () => socket);
  expect(socket.binaryType).toBe("arraybuffer");
  socket.readyState = 1;
  socket.dispatch("open");
  const carrier = await connected;
  carrier.close();
  expect(socket.listenerCount).toBe(0);
  for (const event of ["error", "close"]) {
    const socket = new Socket();
    const result = connectBrowserWebSocket("ws://test", () => socket);
    const check = expect(result).rejects.toMatchObject({
      code: "E_DISCONNECTED",
    });
    socket.dispatch(event, { code: 1006, reason: "error" });
    await check;
    expect(socket.listenerCount).toBe(0);
  }
});

it("browser connector times out stalled handshakes and removes all listeners", async () => {
  vi.useFakeTimers();
  try {
    const socket = new Socket();
    const result = connectBrowserWebSocket("ws://test", () => socket, {
      timeoutMs: 25,
    });
    const check = expect(result).rejects.toMatchObject({
      code: "E_DISCONNECTED",
    });
    await vi.advanceTimersByTimeAsync(25);
    await check;
    expect(socket.readyState).toBe(3);
    expect(socket.listenerCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
it("browser connector handles immediate sockets and normalizes factory errors", async () => {
  const open = new Socket();
  open.readyState = 1;
  const carrier = await connectBrowserWebSocket("ws://test", () => open);
  carrier.close();
  expect(open.listenerCount).toBe(0);
  const closed = new Socket();
  closed.readyState = 3;
  await expect(
    connectBrowserWebSocket("ws://test", () => closed),
  ).rejects.toMatchObject({ code: "E_DISCONNECTED" });
  await expect(
    connectBrowserWebSocket("bad url", () => {
      throw new Error("invalid url");
    }),
  ).rejects.toMatchObject({ code: "E_DISCONNECTED" });
  expect(closed.listenerCount).toBe(0);
});

it("browser sends subarray ranges correctly and copies shared-backed input for DOM BufferSource", () => {
  const socket = new Socket();
  socket.readyState = 1;
  const carrier = browserWebSocketCarrier(socket);
  const bytes = new Uint8Array([99, 1, 2, 99]);
  carrier.send(bytes.subarray(1, 3));
  expect(socket.sent[0]).toEqual(new Uint8Array([1, 2]));
  expect(socket.sent[0]!.buffer).toBe(bytes.buffer);
  const shared = new Uint8Array(new SharedArrayBuffer(2));
  shared.set([3, 4]);
  carrier.send(shared);
  expect(socket.sent[1]).toEqual(new Uint8Array([3, 4]));
  expect(socket.sent[1]!.buffer).toBeInstanceOf(ArrayBuffer);
  carrier.close();
});
