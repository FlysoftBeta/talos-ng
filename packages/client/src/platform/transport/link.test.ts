import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contract } from "@talos/contract";
import { typedCall } from "../../core/data/link.ts";
it("validates typed call input before sending and validates response", async () => {
  const call = vi.fn(async () => ({ data: {}, body: new Uint8Array() }));
  const typed = typedCall({ call });
  await expect(typed(contract.auth.login, { pin: "x" })).rejects.toMatchObject({
    code: "E_INVALID",
  });
  expect(call).not.toHaveBeenCalled();
  await expect(
    typed(contract.auth.login, { pin: "123456" }),
  ).rejects.toMatchObject({ code: "E_PROTOCOL" });
});
it("forwards operation keys and returns validated results", async () => {
  const call = vi.fn(async () => ({
    data: { ok: true },
    body: new Uint8Array(),
  }));
  await expect(
    typedCall({ call })(contract.auth.lock, {}, { op: "test" }),
  ).resolves.toEqual({ ok: true });
  expect(call).toHaveBeenCalledWith("auth.lock", {}, { op: "test" });
});
it("interrupts a recoverable carrier without entering the terminal stopped state", async () => {
  vi.useFakeTimers();
  const { createMemoryCarrierPair, decodeFrame, encodeFrame } =
    await import("@talos/link");
  const { AppLink } = await import("./link.ts");
  let connections = 0;
  const client = new AppLink("test", () => undefined, {
    backoff: { baseMs: 10, maxMs: 10, jitter: 0 },
    connect: async () => {
      connections++;
      const pair = createMemoryCarrierPair();
      pair.b.onMessage((bytes) => {
        if (decodeFrame(bytes).type === 1)
          pair.b.send(
            encodeFrame({
              type: 2,
              header: { v: 1, build: "test", device: "d", conn: "c", now: 0 },
            }),
          );
      });
      return pair.a;
    },
  });
  try {
    client.start();
    await vi.advanceTimersByTimeAsync(5);
    expect(client.state).toBe("open");
    client.interrupt();
    expect(client.state).toBe("waiting");
    await vi.advanceTimersByTimeAsync(15);
    expect(client.state).toBe("open");
    expect(connections).toBe(2);
  } finally {
    client.stop();
    vi.useRealTimers();
  }
});

class FakeSocket extends EventTarget {
  static OPEN = 1;
  static last: FakeSocket;
  binaryType = "";
  readyState = 0;
  sent: unknown[] = [];
  closed: Array<[number?, string?]> = [];
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    super();
    FakeSocket.last = this;
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closed.push([code, reason]);
  }
}

describe("websocket carrier", () => {
  beforeEach(() => vi.stubGlobal("WebSocket", FakeSocket));
  afterEach(() => vi.unstubAllGlobals());

  it("rejects E_OFFLINE when the socket errors or closes before opening", async () => {
    const { websocketCarrier } = await import("./link.ts");
    const a = websocketCarrier("ws://x/link");
    FakeSocket.last.onerror!();
    await expect(a).rejects.toMatchObject({ code: "E_OFFLINE" });
    const b = websocketCarrier("ws://x/link");
    FakeSocket.last.onclose!();
    await expect(b).rejects.toMatchObject({ code: "E_OFFLINE" });
  });

  it("delivers only binary frames, closes with 1003 on text, and unsubscribes", async () => {
    const { websocketCarrier } = await import("./link.ts");
    const pending = websocketCarrier("ws://x/link");
    const socket = FakeSocket.last;
    expect(socket.binaryType).toBe("arraybuffer");
    socket.onopen!();
    const carrier = await pending;
    const got: Uint8Array[] = [];
    const off = carrier.onMessage((bytes) => got.push(bytes));
    socket.dispatchEvent(
      Object.assign(new Event("message"), {
        data: new Uint8Array([1, 2]).buffer,
      }),
    );
    expect([...got[0]!]).toEqual([1, 2]);
    socket.dispatchEvent(Object.assign(new Event("message"), { data: "text" }));
    expect(socket.closed).toEqual([[1003, "Binary frames required"]]);
    off();
    socket.dispatchEvent(
      Object.assign(new Event("message"), { data: new Uint8Array([3]).buffer }),
    );
    expect(got).toHaveLength(1);
    const closes: unknown[] = [];
    carrier.onClose((info) => closes.push(info));
    socket.dispatchEvent(
      Object.assign(new Event("close"), { code: 1006, reason: "lost" }),
    );
    expect(closes).toEqual([{ code: 1006, reason: "lost" }]);
  });

  it("refuses to send on a socket that is no longer open", async () => {
    const { websocketCarrier } = await import("./link.ts");
    const pending = websocketCarrier("ws://x/link");
    const socket = FakeSocket.last;
    socket.onopen!();
    const carrier = await pending;
    socket.readyState = 1;
    carrier.send(new Uint8Array([9]));
    expect(socket.sent).toHaveLength(1);
    socket.readyState = 3;
    expect(() => carrier.send(new Uint8Array([9]))).toThrow(
      expect.objectContaining({ code: "E_DISCONNECTED" }),
    );
  });
});

describe("app link offline guard", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("fails the attempt as E_OFFLINE without dialling when the browser reports offline", async () => {
    const { AppLink } = await import("./link.ts");
    const connect = vi.fn();
    vi.stubGlobal("navigator", { onLine: false });
    const client = new AppLink("test", () => undefined, {
      backoff: { baseMs: 1000, maxMs: 1000, jitter: 0 },
      connect,
    });
    try {
      client.start();
      await new Promise((r) => setTimeout(r, 20));
      expect(connect).not.toHaveBeenCalled();
      expect(client.state).not.toBe("open");
    } finally {
      client.stop();
    }
  });
});
