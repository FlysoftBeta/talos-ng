import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, deferred, equals } from "@talos/base";
import type { CancellationSignal } from "@talos/base";
import { LinkClient } from "./client.ts";
import type { LinkClientOptions } from "./client.ts";
import { LinkServer } from "./server.ts";
import type { LinkServerOptions } from "./server.ts";
import { createMemoryCarrierPair } from "./memory.ts";
import type { MemoryCarrierPair } from "./memory.ts";
import { decodeFrame, encodeFrame } from "./codec.ts";
import type { HelloHeader, Frame } from "./protocol.ts";
const hello = (): HelloHeader => ({
  v: 1,
  build: "test",
  device: null,
  lang: "zh-CN",
});
const tick = (ms = 10) => vi.advanceTimersByTimeAsync(ms);
let cleaners: (() => void)[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  cleaners = [];
});
afterEach(() => {
  for (const cleanup of cleaners.reverse()) cleanup();
  vi.useRealTimers();
});
function setup(
  serverOptions: Partial<LinkServerOptions<string, string>> = {},
  clientOptions: Partial<LinkClientOptions> = {},
) {
  let count = 0;
  const server = new LinkServer<string, string>({
    acceptHello: () => ({
      v: 1,
      build: "test",
      now: Date.now(),
      device: "device",
      conn: `conn-${++count}`,
    }),
    reportIncident: () => "incident-1",
    ...serverOptions,
  });
  const pairs: MemoryCarrierPair[] = [];
  const client = new LinkClient({
    hello,
    backoff: { jitter: 0 },
    connect: async () => {
      const pair = createMemoryCarrierPair();
      pairs.push(pair);
      server.accept(pair.b, "remote");
      return pair.a;
    },
    ...clientOptions,
  });
  cleaners.push(
    () => server.close(),
    () => client.stop(),
  );
  return {
    server,
    client,
    pairs,
    open: async () => {
      client.start();
      await tick();
      expect(client.state).toBe("open");
    },
  };
}
function capture(pair: MemoryCarrierPair): Frame[] {
  const frames: Frame[] = [];
  pair.b.onMessage((bytes) => frames.push(decodeFrame(bytes)));
  return frames;
}
describe("client and server", () => {
  it("handshakes, multiplexes binary RPC/events, exposes connection context and unsubscribes", async () => {
    const { server, client, open } = setup();
    const connect = vi.fn();
    server.onConnection(connect);
    const welcome = vi.fn();
    client.onWelcome(welcome);
    server.register("echo", (conn, args, body) => {
      conn.ctx.set("key", "value");
      return { data: args, body };
    });
    await open();
    expect(welcome).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledOnce();
    const conn = [...server.connections.values()][0]!;
    expect(conn.info).toBe("remote");
    expect(conn.device).toBe("device");
    const calls = [1, 2, 3].map((n) =>
      client.call("echo", n, { body: new Uint8Array([n]) }),
    );
    await tick();
    expect(await Promise.all(calls)).toEqual(
      [1, 2, 3].map((n) => ({ data: n, body: new Uint8Array([n]) })),
    );
    expect(conn.ctx.get("key")).toBe("value");
    const event = vi.fn();
    const off = client.on("news", event);
    conn.emit("news", 42, new Uint8Array([8]));
    await tick();
    expect(event).toHaveBeenCalledWith({ data: 42, body: new Uint8Array([8]) });
    off();
    off();
    conn.emit("news", 43);
    await tick();
    expect(event).toHaveBeenCalledOnce();
  });
  it("never queues calls while idle, connecting, waiting, or stopped", async () => {
    const { client, pairs } = setup();
    await expect(client.call("x", null)).rejects.toMatchObject({
      code: "E_OFFLINE",
    });
    client.start();
    await expect(client.call("x", null)).rejects.toMatchObject({
      code: "E_OFFLINE",
    });
    await tick();
    pairs[0]!.close();
    await expect(client.call("x", null)).rejects.toMatchObject({
      code: "E_OFFLINE",
    });
    client.stop();
    await expect(client.call("x", null)).rejects.toMatchObject({
      code: "E_OFFLINE",
    });
  });
  it("rejects in-flight loss, aborts server handlers and clears carrier listeners", async () => {
    const { server, client, pairs, open } = setup();
    let signal: CancellationSignal | undefined;
    const work = deferred<{ data: number }>();
    server.register("slow", (_c, _a, _b, s) => {
      signal = s;
      return work.promise;
    });
    await open();
    const call = client.call("slow", null);
    const checked = expect(call).rejects.toMatchObject({
      code: "E_DISCONNECTED",
    });
    await tick();
    pairs[0]!.close();
    await checked;
    expect(signal?.aborted).toBe(true);
    expect(server.connections.size).toBe(0);
    expect(pairs[0]!.a.listenerCount).toBe(0);
    expect(pairs[0]!.b.listenerCount).toBe(0);
    work.resolve({ data: 1 });
    await tick();
  });
  it("times out after 30 seconds and sends CANCEL without replaying the call", async () => {
    const { server, client, pairs, open } = setup();
    let signal: CancellationSignal | undefined;
    server.register("slow", (_c, _a, _b, s) => {
      signal = s;
      return new Promise(() => {});
    });
    await open();
    const frames = capture(pairs[0]!);
    const result = client.call("slow", null);
    const check = expect(result).rejects.toMatchObject({ code: "E_TIMEOUT" });
    await tick(30000);
    await check;
    await tick();
    expect(signal?.aborted).toBe(true);
    expect(frames.filter((f) => f.type === 3)).toHaveLength(1);
    expect(frames.some((f) => f.type === 8)).toBe(true);
  });
  it("cancels before sending and while running, cleans signal listeners, ignores late replies", async () => {
    const { server, client, pairs, open } = setup();
    let signal: CancellationSignal | undefined;
    const work = deferred<{ data: number }>();
    server.register("slow", (_c, _a, _b, s) => {
      signal = s;
      return work.promise;
    });
    await open();
    const frames = capture(pairs[0]!);
    const before = new AbortController();
    before.abort();
    await expect(
      client.call("slow", null, { signal: before.signal }),
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const call = client.call("slow", null, { signal: controller.signal });
    const check = expect(call).rejects.toMatchObject({ code: "E_CANCELLED" });
    await tick();
    controller.abort();
    await check;
    await tick();
    expect(signal?.aborted).toBe(true);
    expect(remove).toHaveBeenCalledOnce();
    work.resolve({ data: 42 });
    await tick();
    expect(client.state).toBe("open");
    expect(frames.filter((f) => f.type === 3)).toHaveLength(1);
  });
  it("returns E_BUSY until even a cancelled, uncooperative handler finishes", async () => {
    const { server, client, open } = setup({ maxInFlight: 1 });
    const work = deferred<{ data: number }>();
    server.register("slow", () => work.promise);
    await open();
    const controller = new AbortController();
    const first = client.call("slow", null, { signal: controller.signal });
    const cancelled = expect(first).rejects.toMatchObject({
      code: "E_CANCELLED",
    });
    await tick();
    controller.abort();
    await cancelled;
    await tick();
    const excess = client.call("slow", null);
    const busy = expect(excess).rejects.toMatchObject({ code: "E_BUSY" });
    await tick();
    await busy;
    work.resolve({ data: 7 });
    await tick();
    const next = client.call("slow", null);
    await tick();
    expect((await next).data).toBe(7);
  });
  it("maps missing methods, AppErrors and incidents without leaking internals", async () => {
    const reporter = vi.fn(() => "incident-1");
    const { server, client, open } = setup({ reportIncident: reporter });
    server.register("denied", () => {
      throw new AppError("E_DENIED", "拒绝", { field: "x" });
    });
    server.register("broken", () => {
      throw new Error("secret password");
    });
    await open();
    for (const [method, expected] of [
      ["missing", { code: "E_NOT_FOUND" }],
      ["denied", { code: "E_DENIED", data: { field: "x" } }],
      [
        "broken",
        {
          code: "E_INTERNAL",
          message: "服务内部错误",
          data: { incidentId: "incident-1" },
        },
      ],
    ] as const) {
      const check = expect(client.call(method, null)).rejects.toMatchObject(
        expected,
      );
      await tick();
      await check;
    }
    expect(reporter).toHaveBeenCalledOnce();
    expect(reporter.mock.calls[0]).toEqual([
      expect.any(Error),
      expect.objectContaining({ method: "broken" }),
    ]);
  });
  it("runs middleware around every method, including missing methods, and exposes op", async () => {
    const seen: string[] = [];
    const middleware: LinkServerOptions<string, string>["middleware"] = async (
      context,
      next,
    ) => {
      seen.push(context.method);
      expect(context.op).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
      const value = await next();
      return { ...value, data: "wrapped" };
    };
    const { server, client, open } = setup({ middleware });
    server.register("ok", () => ({ data: "ok" }));
    await open();
    const op = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const ok = client.call("ok", null, { op });
    await tick();
    expect((await ok).data).toBe("wrapped");
    const missing = expect(
      client.call("missing", null, { op }),
    ).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    await tick();
    await missing;
    expect(seen).toEqual(["ok", "missing"]);
  });
  it("stops idempotently, rejects pending calls and cannot restart", async () => {
    const { server, client, open } = setup();
    server.register("slow", () => new Promise(() => {}));
    await open();
    const check = expect(client.call("slow", null)).rejects.toMatchObject({
      code: "E_DISCONNECTED",
    });
    client.stop();
    client.stop();
    client.start();
    await check;
    await tick(100000);
    expect(client.state).toBe("stopped");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("surfaces versionMismatch and permanently stops reconnecting", async () => {
    const { client, pairs } = setup({
      acceptHello: () => new AppError("E_VERSION", "请更新"),
    });
    const version = vi.fn();
    client.onVersionMismatch(version);
    client.start();
    await tick();
    expect(client.state).toBe("versionMismatch");
    expect(version).toHaveBeenCalledWith(
      expect.objectContaining({ code: "E_VERSION" }),
    );
    await tick(100000);
    expect(pairs).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps ping/pong alive, detects silence at 45 s, and reconnects", async () => {
    const { client, pairs, open } = setup();
    await open();
    const frames = capture(pairs[0]!);
    await tick(60000);
    expect(client.state).toBe("open");
    expect(frames.filter((f) => f.type === 6)).toHaveLength(3);
    const pair = createMemoryCarrierPair({ manual: true });
    const silent = new LinkClient({
      hello,
      connect: async () => pair.a,
      backoff: { jitter: 0 },
    });
    cleaners.push(() => silent.stop());
    silent.start();
    await tick(0);
    pair.deliver();
    pair.b.send(
      encodeFrame({
        type: 2,
        header: { v: 1, build: "b", now: 0, device: "d", conn: "c" },
      }),
    );
    pair.deliver();
    expect(silent.state).toBe("open");
    await tick(44999);
    expect(silent.state).toBe("open");
    await tick(1);
    expect(silent.state).toBe("waiting");
  });
  it("handles 50 reconnects without duplicate events or retained carrier listeners", async () => {
    const { server, client, pairs, open } = setup();
    const welcome = vi.fn();
    client.onWelcome(welcome);
    await open();
    for (let i = 0; i < 50; i++) {
      const pair = pairs[i]!;
      pair.close();
      await tick(510);
      expect(client.state).toBe("open");
      expect(pair.a.listenerCount + pair.b.listenerCount).toBe(0);
      expect(server.connections.size).toBe(1);
    }
    expect(welcome).toHaveBeenCalledTimes(51);
    client.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses unique increasing ids after cancellation and timeout", async () => {
    const { server, client, pairs, open } = setup();
    server.register("ok", () => ({}));
    await open();
    const frames = capture(pairs[0]!);
    for (let i = 0; i < 100; i++) {
      const call = client.call("ok", null);
      await tick();
      await call;
    }
    const ids = frames.filter((f) => f.type === 3).map((f) => f.header.id);
    expect(new Set(ids).size).toBe(100);
    expect(ids).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });
  it("supports near-limit bodies end to end", async () => {
    const { server, client, open } = setup();
    server.register("echo", (_c, _a, body) => ({ body }));
    await open();
    const body = new Uint8Array(4 * 1024 * 1024 - 128).fill(254);
    const call = client.call("echo", null, { body });
    await tick();
    expect(equals((await call).body, body)).toBe(true);
  });
});
describe("connection edge cases", () => {
  it("backs off exponentially with deterministic jitter and caps delays", async () => {
    const times: number[] = [];
    const client = new LinkClient({
      hello,
      connect: async () => {
        times.push(Date.now());
        throw new Error("down");
      },
      random: () => 0.75,
      backoff: { baseMs: 100, maxMs: 500, jitter: 0.2 },
    });
    cleaners.push(() => client.stop());
    client.start();
    await tick(0);
    await tick(110);
    await tick(220);
    await tick(440);
    await tick(500);
    expect(times).toEqual([1000, 1110, 1330, 1770, 2270]);
  });
  it("times out stalled connect and closes a late result", async () => {
    const connecting =
      deferred<ReturnType<typeof createMemoryCarrierPair>["a"]>();
    const pair = createMemoryCarrierPair();
    const client = new LinkClient({ hello, connect: () => connecting.promise });
    cleaners.push(() => client.stop());
    client.start();
    await tick(8000);
    expect(client.state).toBe("waiting");
    const closed = vi.fn();
    pair.b.onClose(closed);
    connecting.resolve(pair.a);
    await tick(0);
    expect(closed).toHaveBeenCalledOnce();
  });
  it("is safe when an onState listener stops during connecting, open, or waiting", async () => {
    for (const target of ["connecting", "open", "waiting"]) {
      const { client, pairs } = setup();
      client.onState((state) => {
        if (state === target) client.stop();
      });
      client.start();
      await tick();
      if (target === "waiting") pairs[0]!.close();
      expect(client.state).toBe("stopped");
    }
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects a non-HELLO first frame and enforces HELLO deadline", async () => {
    const { server } = setup();
    for (const frame of [
      undefined,
      encodeFrame({ type: 6, header: { n: 1 } }),
    ]) {
      const pair = createMemoryCarrierPair();
      const replies: Frame[] = [];
      pair.a.onMessage((b) => replies.push(decodeFrame(b)));
      server.accept(pair.b, "remote");
      if (frame) pair.a.send(frame);
      await tick(frame ? 10 : 5000);
      expect(replies[0]).toMatchObject({
        type: 9,
        header: { code: "E_PROTOCOL" },
      });
      expect(server.connections.size).toBe(0);
    }
  });
  it("enforces idle timeout and gracefully closes all connections and handshakes", async () => {
    const { server, client, pairs, open } = setup({ idleTimeoutMs: 100 });
    await open();
    await tick(100);
    expect(client.state).toBe("waiting");
    expect(server.connections.size).toBe(0);
    const pending = createMemoryCarrierPair();
    server.accept(pending.b, "pending");
    const closed = vi.fn();
    pending.a.onClose(closed);
    server.close();
    server.close();
    expect(closed).toHaveBeenCalledOnce();
    expect(pairs[0]!.b.listenerCount).toBe(0);
    const rejected = createMemoryCarrierPair();
    server.accept(rejected.b, "new");
    expect(rejected.b.listenerCount).toBe(0);
  });
  it("closes malformed/oversized inbound frames with E_PROTOCOL", async () => {
    for (const bytes of [new Uint8Array([255]), new Uint8Array(1025)]) {
      const { server } = setup({ maxFrameBytes: 1024 });
      const pair = createMemoryCarrierPair();
      const replies: Frame[] = [];
      pair.a.onMessage((b) => replies.push(decodeFrame(b)));
      server.accept(pair.b, "remote");
      pair.a.send(bytes);
      await tick();
      expect(replies[0]).toMatchObject({
        type: 9,
        header: { code: "E_PROTOCOL" },
      });
    }
  });
});

it("client rejects malformed server frames, ignores late replies and answers peer PING", async () => {
  const pair = createMemoryCarrierPair({ manual: true });
  const client = new LinkClient({ hello, connect: async () => pair.a });
  cleaners.push(() => client.stop());
  const frames: Frame[] = [];
  pair.b.onMessage((bytes) => frames.push(decodeFrame(bytes)));
  client.start();
  await tick(0);
  pair.deliver();
  pair.b.send(
    encodeFrame({
      type: 2,
      header: { v: 1, build: "b", now: 0, device: "d", conn: "c" },
    }),
  );
  pair.deliver();
  pair.b.send(
    encodeFrame({ type: 4, header: { id: 999, ok: true, d: "late" } }),
  );
  pair.deliver();
  expect(client.state).toBe("open");
  pair.b.send(encodeFrame({ type: 6, header: { n: 123 } }));
  pair.deliver();
  pair.deliver();
  expect(frames.at(-1)).toMatchObject({ type: 7, header: { n: 123 } });
  pair.b.send(new Uint8Array([255]));
  pair.deliver();
  expect(client.state).toBe("waiting");
  expect(frames.at(-1)).toMatchObject({
    type: 9,
    header: { code: "E_PROTOCOL" },
  });
});
it("client treats an incompatible WELCOME as terminal and times out a silent handshake", async () => {
  for (const v of [2, undefined]) {
    const pair = createMemoryCarrierPair({ manual: true });
    const client = new LinkClient({ hello, connect: async () => pair.a });
    cleaners.push(() => client.stop());
    client.start();
    await tick(0);
    pair.deliver();
    if (v) {
      pair.b.send(
        encodeFrame({
          type: 2,
          header: { v, build: "b", now: 0, device: "d", conn: "c" },
        }),
      );
      pair.deliver();
      expect(client.state).toBe("versionMismatch");
    } else {
      await tick(8000);
      expect(client.state).toBe("waiting");
    }
    client.stop();
    expect(pair.a.listenerCount).toBe(0);
  }
});
it("stop suppresses unstarted factories and closes an already pending factory result", async () => {
  const connect = vi.fn(async () => createMemoryCarrierPair().a);
  const first = new LinkClient({ hello, connect });
  first.start();
  first.stop();
  await tick(0);
  expect(connect).not.toHaveBeenCalled();
  const pair = createMemoryCarrierPair();
  const pending = deferred<typeof pair.a>();
  const second = new LinkClient({ hello, connect: () => pending.promise });
  second.start();
  await tick(0);
  second.stop();
  const closed = vi.fn();
  pair.b.onClose(closed);
  pending.resolve(pair.a);
  await tick(0);
  expect(closed).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("client maps carrier send failures to E_DISCONNECTED and local encoding errors to E_PROTOCOL", async () => {
  const { server, client, pairs, open } = setup();
  server.register("ok", () => ({}));
  await open();
  await expect(client.call("ok", undefined)).rejects.toMatchObject({
    code: "E_PROTOCOL",
  });
  expect(client.state).toBe("open");
  pairs[0]!.a.send = () => {
    throw new Error("socket failed");
  };
  await expect(client.call("ok", null)).rejects.toMatchObject({
    code: "E_DISCONNECTED",
  });
  expect(client.state).toBe("waiting");
});
it("server rejects duplicate pending IDs and prevents protocol-version admission", async () => {
  const acceptHello = vi.fn(() => ({
    v: 1,
    build: "test",
    now: 0,
    device: "d",
    conn: "c",
  }));
  const { server, client, pairs, open } = setup({ acceptHello });
  server.register("slow", () => new Promise(() => {}));
  await open();
  const call = client.call("slow", null);
  const check = expect(call).rejects.toMatchObject({ code: "E_DISCONNECTED" });
  await tick();
  pairs[0]!.a.send(
    encodeFrame({ type: 3, header: { id: 0, m: "slow", a: null } }),
  );
  await tick();
  await check;
  const pair = createMemoryCarrierPair();
  const frames: Frame[] = [];
  pair.a.onMessage((bytes) => frames.push(decodeFrame(bytes)));
  server.accept(pair.b, "remote");
  pair.a.send(encodeFrame({ type: 1, header: { ...hello(), v: 2 } }));
  await tick();
  expect(frames[0]).toMatchObject({ type: 9, header: { code: "E_VERSION" } });
  expect(acceptHello).toHaveBeenCalledOnce();
});
it("server contains admission/reporter failures and method registrations are safely removable", async () => {
  const { server, client } = setup({
    acceptHello: () => {
      throw new Error("private");
    },
    reportIncident: () => {
      throw new Error("reporter failed");
    },
  });
  const off = server.register("m", () => ({}));
  expect(() => server.register("m", () => ({}))).toThrow(
    expect.objectContaining({ code: "E_INVALID" }),
  );
  off();
  server.register("m", () => ({}));
  off();
  expect(() => server.register("m", () => ({}))).toThrow(
    expect.objectContaining({ code: "E_INVALID" }),
  );
  client.start();
  await tick();
  expect(client.state).toBe("waiting");
  expect(server.connections.size).toBe(0);
});
it("validates constructor timing/limit settings as AppErrors", () => {
  for (const options of [
    { maxFrameBytes: 0 },
    { connectTimeoutMs: -1 },
    { pingIntervalMs: 0 },
    { deadTimeoutMs: 0 },
    { backoff: { baseMs: 0 } },
  ])
    expect(
      () =>
        new LinkClient({
          hello,
          connect: async () => createMemoryCarrierPair().a,
          ...options,
        }),
    ).toThrow(AppError);
  for (const options of [
    { maxInFlight: 0 },
    { idleTimeoutMs: 0 },
    { helloTimeoutMs: -1 },
  ])
    expect(
      () =>
        new LinkServer({
          acceptHello: () => ({
            v: 1,
            build: "b",
            now: 0,
            device: "d",
            conn: "c",
          }),
          reportIncident: () => "id",
          ...options,
        }),
    ).toThrow(AppError);
});

describe("server lifecycle edges", () => {
  it("refuses duplicate and empty method registrations; unregistering a replaced handler is a no-op", () => {
    const { server } = setup();
    const off = server.register("m", async () => ({ data: null }));
    expect(() =>
      server.register("m", async () => ({ data: null })),
    ).toThrowError(expect.objectContaining({ code: "E_INVALID" }));
    expect(() => server.register("", async () => ({ data: null }))).toThrow();
    off();
    off();
    const again = server.register("m", async () => ({ data: null }));
    off();
    expect(() => server.register("m", async () => ({ data: null }))).toThrow();
    again();
  });
  it("closes a carrier accepted after the server closed, and rejects emit before the handshake", () => {
    const { server } = setup();
    const early = createMemoryCarrierPair();
    const connection = server.accept(early.b, "remote");
    expect(() => connection.emit("topic", null)).toThrowError(
      expect.objectContaining({ code: "E_OFFLINE" }),
    );
    server.close();
    server.close();
    const late = createMemoryCarrierPair();
    const closed = vi.fn();
    late.a.onClose(closed);
    server.accept(late.b, "remote");
    expect(closed).toHaveBeenCalled();
  });
  it("drops a connection whose carrier fails on send and reports disconnect once", async () => {
    const { server, client, pairs, open } = setup();
    const gone = vi.fn();
    server.onDisconnect(gone);
    await open();
    const conn = [...server.connections.values()][0]!;
    pairs[0]!.b.send = () => {
      throw new Error("pipe broken");
    };
    expect(() => conn.emit("t", 1)).toThrowError(
      expect.objectContaining({ code: "E_DISCONNECTED" }),
    );
    await tick();
    expect(gone).toHaveBeenCalledTimes(1);
    expect(client.state).not.toBe("stopped");
  });
});
