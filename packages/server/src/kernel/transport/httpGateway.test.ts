import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { request as secureRequest } from "node:https";
import { describe, expect, it } from "vitest";
import { createMemoryObjectStore } from "@talos/objectstore";
import { LinkClient, LinkServer } from "@talos/link";
import { connectNodeWebSocket } from "@talos/link/ws-node";
import { createUlid, sha256Hex } from "@talos/base";
import { TicketService } from "../objects/tickets.ts";
import { parseHttpRange } from "./http-range.ts";
import { startHttpGateway } from "./httpGateway.ts";

async function get(
  port: number,
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
): Promise<{
  status: number;
  headers: Record<string, unknown>;
  bytes: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", port, path, headers, method },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            bytes: Buffer.concat(chunks),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}
describe("HTTP ranges", () => {
  it.each([
    ["bytes=0-2", { start: 0, end: 3 }],
    ["bytes=2-", { start: 2, end: 10 }],
    ["bytes=-3", { start: 7, end: 10 }],
    ["bytes=0-999", { start: 0, end: 10 }],
  ])("parses %s", (value, expected) => {
    expect(parseHttpRange(value as string, 10)).toEqual(expected);
  });
  it.each([
    "bytes=",
    "bytes=-0",
    "bytes=10-",
    "bytes=2-1",
    "bytes=0-1,4-5",
    "items=0-1",
    "bytes=9007199254740992-",
  ])("rejects %s", (value) => {
    expect(() => parseHttpRange(value, 10)).toThrow();
  });
});
it("range parsing preserves length and bounds for generated valid ranges", () => {
  let seed = 83;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < 500; i++) {
    const size = 1 + (next() % 10000);
    const start = next() % size;
    const last = start + (next() % (size + 100));
    const range = parseHttpRange(`bytes=${start}-${last}`, size);
    expect(range.start).toBe(start);
    expect(range.end).toBe(Math.min(last + 1, size));
    expect(range.end).toBeGreaterThan(range.start);
  }
});
describe("download tickets", () => {
  it("binds identity and metadata, expires, revokes, and rechecks access", async () => {
    let now = 100;
    let allowed = true;
    let seq = 0;
    const service = new TicketService({
      clock: () => now,
      ttlMs: 10,
      random: () => `${++seq}`.padStart(20, "x"),
      access: (user) => user === "u" && allowed,
    });
    const info = {
      user: "u",
      objectId: "a".repeat(64),
      filename: "书籍.pdf",
      mime: "application/pdf",
    };
    const ticket = service.issue(info);
    expect(await service.resolve(ticket.ticket)).toMatchObject(info);
    allowed = false;
    await expect(service.resolve(ticket.ticket)).rejects.toMatchObject({
      code: "E_DENIED",
    });
    allowed = true;
    const expired = service.issue(info);
    now += 10;
    await expect(service.resolve(expired.ticket)).rejects.toMatchObject({
      code: "E_NOT_FOUND",
    });
    const revoked = service.issue(info);
    service.revokeUser("u");
    await expect(service.resolve(revoked.ticket)).rejects.toMatchObject({
      code: "E_NOT_FOUND",
    });
    expect(() =>
      service.issue({ ...info, mime: "text/plain\r\nBad: yes" }),
    ).toThrow();
  });
});
describe("real socket gateway", () => {
  it("serves boot snapshots, hashes, exact cache policy, CA and rejects traversal", async () => {
    const dir = await mkdtemp(join(tmpdir(), "talos-http-"));
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "index.html"), "<html>shell</html>");
    await writeFile(join(dir, "sw.js"), "// worker");
    await writeFile(join(dir, "assets", "main.js"), "// code");
    const gateway = await startHttpGateway({
      ports: [0, 0],
      build: "test",
      assetsDir: dir,
      store: createMemoryObjectStore(),
      tickets: new TicketService(),
      ca: Uint8Array.of(1, 2),
    });
    try {
      for (const { port } of gateway.addresses) {
        expect((await get(port, "/")).headers["cache-control"]).toBe(
          "no-store",
        );
        expect((await get(port, "/sw.js")).headers["cache-control"]).toBe(
          "no-store",
        );
        expect(
          (await get(port, "/sw.js")).headers["service-worker-allowed"],
        ).toBe("/");
        expect((await get(port, "/sw.js")).headers["content-type"]).toContain(
          "javascript",
        );
        const manifest = await get(port, "/app/manifest.json");
        expect(manifest.headers["cache-control"]).toBe("no-store");
        expect(JSON.parse(manifest.bytes.toString())).toEqual({
          build: "test",
          assets: [
            {
              path: "/app/test/assets/main.js",
              size: 7,
              sha256: sha256Hex(Buffer.from("// code")),
              mime: "text/javascript; charset=utf-8",
            },
            {
              path: "/app/test/index.html",
              size: 18,
              sha256: sha256Hex(Buffer.from("<html>shell</html>")),
              mime: "text/html; charset=utf-8",
            },
            {
              path: "/app/test/sw.js",
              size: 9,
              sha256: sha256Hex(Buffer.from("// worker")),
              mime: "text/javascript; charset=utf-8",
            },
          ],
        });
        const asset = await get(port, "/app/test/assets/main.js");
        expect(asset.headers["cache-control"]).toContain("immutable");
        expect(asset.bytes.toString()).toBe("// code");
        expect((await get(port, "/ca.crt")).bytes).toEqual(Buffer.from([1, 2]));
        for (const path of [
          "/../x",
          "/app/test/%2e%2e/x",
          "/app/test/%5c..%5cx",
          "/%00",
          "/%zz",
        ])
          expect((await get(port, path)).status).toBe(400);
        for (const path of ["/business", "/a/b?x=1"]) {
          const stray = await get(port, path);
          expect(stray.status).toBe(301);
          expect(stray.headers.location).toBe("/");
        }
        for (const path of ["/app/test/missing.js", "/app/other", "/dl/"])
          expect((await get(port, path)).status).toBe(404);
        expect((await get(port, "/", {}, "POST")).status).toBe(405);
        expect((await get(port, "/link")).status).toBe(426);
      }
    } finally {
      await gateway.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("streams inclusive/suffix ranges and HEAD with protected filename metadata", async () => {
    const store = createMemoryObjectStore();
    const object = await store.put(
      Uint8Array.from({ length: 256 }, (_, i) => i),
    );
    const tickets = new TicketService();
    const ticket = tickets.issue({
      user: "u",
      objectId: object.id,
      filename: "书籍.bin",
      mime: "application/octet-stream",
    });
    const gateway = await startHttpGateway({
      ports: [0],
      build: "test",
      store,
      tickets,
    });
    const port = gateway.addresses[0]!.port;
    try {
      const range = await get(port, ticket.url, { Range: "bytes=20-39" });
      expect(range.status).toBe(206);
      expect(range.headers["content-range"]).toBe("bytes 20-39/256");
      expect(range.bytes).toEqual(
        Buffer.from(Uint8Array.from({ length: 20 }, (_, i) => i + 20)),
      );
      expect(range.headers["content-disposition"]).toContain(
        "filename*=UTF-8''",
      );
      expect(
        (await get(port, ticket.url, { Range: "bytes=-2" })).bytes,
      ).toEqual(Buffer.from([254, 255]));
      expect((await get(port, ticket.url, {}, "HEAD")).bytes.length).toBe(0);
      expect(
        (await get(port, ticket.url, { Range: "bytes=999-" })).status,
      ).toBe(416);
      expect((await get(port, ticket.url)).bytes.length).toBe(256);
      tickets.revokeUser("u");
      expect((await get(port, ticket.url)).status).toBe(404);
    } finally {
      await gateway.close();
    }
  });
  it("serves HTTPS on configured secure ports with explicit TLS material", async () => {
    // Public test-only certificate/key, generated once; no openssl dependency at test runtime.
    const cert = await readFile(
      new URL("./http-fixtures/cert.pem", import.meta.url),
    );
    const key = await readFile(
      new URL("./http-fixtures/key.pem", import.meta.url),
    );
    const gateway = await startHttpGateway({
      ports: [],
      securePorts: [0],
      build: "secure",
      store: createMemoryObjectStore(),
      tickets: new TicketService(),
      tls: { cert, key },
    });
    try {
      expect(gateway.addresses[0]!.secure).toBe(true);
      const body = await new Promise<string>((resolve, reject) => {
        const req = secureRequest(
          {
            hostname: "127.0.0.1",
            port: gateway.addresses[0]!.port,
            path: "/app/manifest.json",
            ca: cert,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(chunk as Buffer));
            res.on("end", () => resolve(Buffer.concat(chunks).toString()));
            res.on("error", reject);
          },
        );
        req.on("error", reject);
        req.end();
      });
      expect(JSON.parse(body)).toEqual({ build: "secure", assets: [] });
    } finally {
      await gateway.close();
    }
  });
  it("redirects only to configured HTTPS authority", async () => {
    const gateway = await startHttpGateway({
      ports: [0],
      build: "test",
      store: createMemoryObjectStore(),
      tickets: new TicketService(),
      redirect: { domain: "talos.example", port: 8443 },
    });
    try {
      const res = await get(gateway.addresses[0]!.port, "/?next=test", {
        Host: "attacker.example",
      });
      expect(res.status).toBe(308);
      expect(res.headers.location).toBe(
        "https://talos.example:8443/?next=test",
      );
    } finally {
      await gateway.close();
    }
  });
  it("upgrades /link and carries a real LinkClient call", async () => {
    const id = createUlid();
    const link = new LinkServer({
      acceptHello: () => ({
        v: 1,
        build: "test",
        now: 1,
        conn: id(),
        device: id(),
      }),
      reportIncident: () => id(),
    });
    link.register("echo", (_conn, args) => ({ data: args }));
    const gateway = await startHttpGateway({
      ports: [0],
      build: "test",
      store: createMemoryObjectStore(),
      tickets: new TicketService(),
      onConnection: (carrier, info) => {
        link.accept(carrier, info);
      },
    });
    const client = new LinkClient({
      connect: () =>
        connectNodeWebSocket(
          `ws://127.0.0.1:${gateway.addresses[0]!.port}/link`,
        ),
      hello: () => ({ v: 1, build: "test", device: null, lang: "zh-CN" }),
    });
    try {
      const welcome = new Promise<void>((resolve) =>
        client.onWelcome(() => resolve()),
      );
      client.start();
      await welcome;
      expect((await client.call("echo", { hello: "world" })).data).toEqual({
        hello: "world",
      });
    } finally {
      client.stop();
      link.close();
      await gateway.close();
    }
  });
});

it("missing dist serves a clear non-cacheable page while HTTP gateway remains available", async () => {
  const gateway = await startHttpGateway({
    ports: [0],
    build: "test",
    assetsDir: join(tmpdir(), "talos-nonexistent-dist"),
    store: createMemoryObjectStore(),
    tickets: new TicketService(),
  });
  try {
    const response = await get(gateway.addresses[0]!.port, "/");
    expect(response.status).toBe(503);
    expect(response.bytes.toString()).toContain("pnpm build");
    expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect((await get(gateway.addresses[0]!.port, "/link")).status).toBe(426);
  } finally {
    await gateway.close();
  }
});
