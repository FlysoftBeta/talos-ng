import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { LinkClient } from "../client.ts";
import { LinkServer } from "../server.ts";
import { attachWebSocketServer, connectNodeWebSocket } from "./index.ts";
function listening(server: Server, port = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}
function closed(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
function welcome(client: LinkClient): Promise<void> {
  return new Promise((resolve) => {
    const off = client.onWelcome(() => {
      off();
      resolve();
    });
  });
}
it("real ws round-trips binary and reconnects after an HTTP/WebSocket server restart", async () => {
  let count = 0;
  const make = async (port = 0) => {
    const http = createServer();
    const link = new LinkServer<{ remoteAddress?: string }>({
      acceptHello: () => ({
        v: 1,
        build: "test",
        now: Date.now(),
        device: "device",
        conn: `c-${++count}`,
      }),
      reportIncident: () => "incident",
    });
    link.register("echo", (conn, args, body) => {
      expect(conn.info.remoteAddress).toBe("127.0.0.1");
      return { data: args, body };
    });
    const adapter = attachWebSocketServer({
      server: http,
      path: "/link",
      onConnection: (carrier, info) => link.accept(carrier, info),
    });
    await listening(http, port);
    return { http, link, adapter, port: (http.address() as AddressInfo).port };
  };
  let live = await make();
  const port = live.port;
  const client = new LinkClient({
    hello: () => ({ v: 1, build: "test", device: null, lang: "zh-CN" }),
    connect: () => connectNodeWebSocket(`ws://127.0.0.1:${port}/link`),
    backoff: { baseMs: 10, maxMs: 50, jitter: 0 },
  });
  try {
    const ready = welcome(client);
    client.start();
    await ready;
    const body = new Uint8Array([0, 255, 128, 1]);
    expect(await client.call("echo", { hello: "你好" }, { body })).toEqual({
      data: { hello: "你好" },
      body,
    });
    const again = welcome(client);
    live.link.close();
    await live.adapter.close();
    await closed(live.http);
    live = await make(port);
    await again;
    expect(await client.call("echo", "after restart", { body })).toEqual({
      data: "after restart",
      body,
    });
    expect(count).toBe(2);
    client.stop();
    live.link.close();
    await live.adapter.close();
    expect(live.http.listenerCount("upgrade")).toBe(0);
  } finally {
    client.stop();
    live.link.close();
    await live.adapter.close();
    if (live.http.listening) await closed(live.http);
  }
});
it("ws enforces binary messages and max payload and disables compression", async () => {
  const server = createServer();
  const adapter = attachWebSocketServer({
    server,
    path: "/link",
    maxFrameBytes: 128,
    onConnection: () => {},
  });
  await listening(server);
  const port = (server.address() as AddressInfo).port;
  try {
    for (const payload of ["text", new Uint8Array(129)]) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/link`);
      await once(socket, "open");
      expect(socket.extensions).toBe("");
      const close = once(socket, "close");
      socket.send(payload);
      const [code] = await close;
      expect(code).toBe(typeof payload === "string" ? 1003 : 1009);
    }
  } finally {
    await adapter.close();
    await closed(server);
  }
});
it("node client rejects refused connections as AppError", async () => {
  const server = createServer();
  await listening(server);
  const port = (server.address() as AddressInfo).port;
  await closed(server);
  await expect(
    connectNodeWebSocket(`ws://127.0.0.1:${port}/link`),
  ).rejects.toMatchObject({ code: "E_DISCONNECTED" });
});
