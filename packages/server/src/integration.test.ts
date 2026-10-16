import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { createUlid, deferred } from "@talos/base";
import { createApi } from "@talos/contract";
import type { Api } from "@talos/contract";
import { LinkClient, createMemoryCarrierPair } from "@talos/link";
import { connectNodeWebSocket } from "@talos/link/ws-node";
import { createMemoryObjectStore } from "@talos/objectstore";
import { createKernel } from "./app/create-application.ts";
import type { Kernel } from "./app/create-application.ts";
import { Db } from "./kernel/persistence/db.ts";
import { startHttpGateway } from "./kernel/transport/httpGateway.ts";
import type { SyncResponse } from "./kernel/sync/sync-hub.ts";
import { parseConfig } from "./kernel/config/config.ts";
import { startServer } from "./main.ts";
async function connect(
  kernel: Kernel,
  device: string | null,
  url?: string,
): Promise<{ client: LinkClient; api: Api }> {
  const ready = deferred<void>();
  const client = new LinkClient({
    connect: async () => {
      if (url) return connectNodeWebSocket(url);
      const pair = createMemoryCarrierPair();
      kernel.host.link.accept(pair.b, {});
      return pair.a;
    },
    hello: () => ({ v: 1, build: "test", device, lang: "zh-CN" }),
  });
  client.onWelcome(() => ready.resolve());
  client.start();
  await ready.promise;
  return { client, api: createApi(client.call.bind(client)) };
}
function download(
  port: number,
  path: string,
  range?: string,
): Promise<{ status: number; body: Buffer; range: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, headers: range ? { Range: range } : {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            body: Buffer.concat(chunks),
            range: res.headers["content-range"],
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}
describe.each(["memory", "ws"] as const)(
  "kernel full workflow over %s",
  (transport) => {
    it("authenticates, synchronizes, replays, resumes a 5 MiB upload, downloads ranges and delivers jobs", async () => {
      const db = new Db();
      let pin = "";
      const store = createMemoryObjectStore();
      const kernel = createKernel({
        db,
        store,
        build: "test",
        dev: true,
        printRootPin: (value) => {
          pin = value;
        },
      });
      const gateway = await startHttpGateway({
        ports: [0],
        bindHost: "127.0.0.1",
        build: "test",
        store,
        tickets: kernel.tickets,
        onConnection: (carrier, info) => {
          kernel.host.link.accept(carrier, info);
        },
      });
      const port = gateway.addresses[0]!.port;
      const url =
        transport === "ws" ? `ws://127.0.0.1:${port}/link` : undefined;
      const clients: LinkClient[] = [];
      try {
        let first = await connect(kernel, null, url);
        clients.push(first.client);
        const { device } = await first.api.auth.device.register({
          label: "test tablet",
        });
        const session = await first.api.auth.login({ pin });
        if (!("user" in session)) throw new Error("expected user session");
        const pulled = await first.api.sync.pull({ cursors: {} });
        const scope = `me:${session.user.id}`;
        expect(pulled.added).toEqual(
          expect.arrayContaining(["learn", scope, "sys"]),
        );
        expect(
          pulled.added.filter((id) => id.startsWith("conv:")),
        ).toHaveLength(2);
        expect(
          pulled.scopes[scope]?.rows.some((row) => row.type === "profile"),
        ).toBe(true);
        const second = await connect(kernel, device, url);
        clients.push(second.client);
        await second.api.auth.resume({ token: session.token });
        await second.api.sync.pull({ cursors: {} });
        const deltas: SyncResponse[] = [];
        second.client.on("sync.delta", (event) =>
          deltas.push(event.data as SyncResponse),
        );
        const op = createUlid()();
        const setting = {
          key: "theme",
          value: { v: "dark", t: { ms: Date.now(), counter: 0 }, op },
        };
        const saved = await first.api.me.setting.set(setting, { op });
        const revision = kernel.uow.revision;
        expect(await first.api.me.setting.set(setting, { op })).toEqual(saved);
        expect(kernel.uow.revision).toBe(revision);
        expect(
          deltas
            .flatMap((delta) => delta.scopes[scope]?.rows ?? [])
            .filter((row) => row.type === "setting"),
        ).toHaveLength(1);
        const pullAgain = await first.api.sync.pull({
          cursors: { [scope]: pulled.scopes[scope]!.cursor },
        });
        expect(
          pullAgain.scopes[scope]?.rows.find((row) => row.type === "setting"),
        ).toEqual(deltas[0]?.scopes[scope]?.rows[0]);
        const bytes = Buffer.alloc(5 * 1024 * 1024);
        for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const begin = await first.api.upload.begin({
          kind: "file",
          size: bytes.length,
          sha256,
        });
        const chunk = 512 * 1024;
        for (let offset = 0; offset < bytes.length / 2; offset += chunk)
          await first.api.upload.append(
            { id: begin.id, offset },
            { body: bytes.subarray(offset, offset + chunk) },
          );
        first.client.stop();
        first = await connect(kernel, device, url);
        clients.push(first.client);
        await first.api.auth.resume({ token: session.token });
        expect(
          (
            await first.api.upload.begin({
              id: begin.id,
              kind: "file",
              size: bytes.length,
              sha256,
            })
          ).offset,
        ).toBe(bytes.length / 2);
        for (
          let offset = bytes.length / 2;
          offset < bytes.length;
          offset += chunk
        )
          await first.api.upload.append(
            { id: begin.id, offset },
            { body: bytes.subarray(offset, offset + chunk) },
          );
        const committed = await first.api.upload.commit({ id: begin.id });
        expect(committed.object).toEqual({ id: sha256, size: bytes.length });
        const ticket = await first.api.upload.ticket({
          id: begin.id,
          filename: "测试.bin",
          mime: "application/octet-stream",
        });
        const downloaded = await download(port, ticket.url, "bytes=1024-4095");
        expect(downloaded.status).toBe(206);
        expect(downloaded.body).toEqual(bytes.subarray(1024, 4096));
        expect(downloaded.range).toBe(`bytes 1024-4095/${bytes.length}`);
        const done = deferred<void>();
        const states: string[] = [];
        const progress: number[] = [];
        const off = second.client.on("sync.delta", (event) => {
          const delta = event.data as SyncResponse;
          for (const row of delta.scopes[scope]?.rows ?? [])
            if (row.type === "job") {
              const data = row.data as { state: string; progress: number };
              states.push(data.state);
              progress.push(data.progress);
              if (data.state === "done") done.resolve();
            }
        });
        const job = kernel.jobs.enqueue(session.user.id, "debug.sleep", {
          ms: 10,
          steps: 2,
        });
        await done.promise;
        off();
        expect(states).toContain("running");
        expect(states).toContain("done");
        expect(progress).toContain(1);
        expect(kernel.jobs.get(job.id)?.state).toBe("done");
        await first.api.auth.logout({});
        await expect(second.api.sys.time({})).resolves.toHaveProperty("now");
        await expect(
          second.api.sync.pull({ cursors: {} }),
        ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
        expect((await download(port, ticket.url)).status).toBe(404);
      } finally {
        for (const client of clients) client.stop();
        await kernel.close();
        await gateway.close();
        db.close();
      }
    });
  },
);
it("restart preserves idempotent results and requeues interrupted jobs; close checkpoints WAL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "talos-restart-"));
  const path = join(dir, "talos.db");
  const store = createMemoryObjectStore();
  let pin = "";
  let db = new Db(path);
  let kernel = createKernel({
    db,
    store,
    build: "test",
    dev: true,
    printRootPin: (value) => {
      pin = value;
    },
  });
  let current = await connect(kernel, null);
  const device = (await current.api.auth.device.register({})).device;
  const session = await current.api.auth.login({ pin });
  if (!("user" in session)) throw new Error("expected user session");
  const op = createUlid()();
  const args = {
    key: "restart",
    value: { v: 17, t: { ms: Date.now(), counter: 0 }, op },
  };
  const saved = await current.api.me.setting.set(args, { op });
  const job = kernel.jobs.enqueue(
    session.user.id,
    "debug.sleep",
    { ms: 1, steps: 1 },
    { runAfter: Date.now() + 100000 },
  );
  // Represents the durable state left by a process interrupted during execution.
  db.run("UPDATE jobs SET state='running' WHERE id=?", job.id);
  current.client.stop();
  await kernel.close();
  db.close();
  expect(
    await stat(path + "-wal").then(
      (s) => s.size,
      () => 0,
    ),
  ).toBe(0);
  db = new Db(path);
  kernel = createKernel({
    db,
    store,
    build: "test",
    dev: true,
    printRootPin: () => {
      throw new Error("root PIN must not print twice");
    },
  });
  try {
    expect(kernel.jobs.get(job.id)?.state).toBe("queued");
    current = await connect(kernel, device);
    await current.api.auth.resume({ token: session.token });
    const revision = kernel.uow.revision;
    expect(await current.api.me.setting.set(args, { op })).toEqual(saved);
    expect(kernel.uow.revision).toBe(revision);
  } finally {
    current.client.stop();
    await kernel.close();
    db.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});
it("startServer binds every port and closes idempotently", async () => {
  const dir = await mkdtemp(join(tmpdir(), "talos-main-"));
  try {
    await mkdir(join(dir, "assets"));
    const aiModelsFile = join(dir, "ai.json");
    await writeFile(
      aiModelsFile,
      JSON.stringify({
        baseURL: "http://127.0.0.1:1/v1",
        key: "test-secret",
        models: [
          {
            name: "audit-model",
            inputPrice: 1,
            cachedPrice: 0,
            outputPrice: 2,
            maxOutput: 128,
          },
        ],
      }),
    );
    const server = await startServer(
      parseConfig({
        ports: [0, 0],
        aiModelsFile,
        bindHost: "127.0.0.1",
        dataDir: dir,
        assetsDir: join(dir, "assets"),
      }),
      { printRootPin: () => {} },
    );
    expect(server.kernel.ai.options.provider?.models[0]?.name).toBe(
      "audit-model",
    );
    expect(server.addresses).toHaveLength(2);
    for (const address of server.addresses)
      expect((await download(address.port, "/app/manifest.json")).status).toBe(
        200,
      );
    await Promise.all([server.close(), server.close()]);
    expect(
      await stat(join(dir, "talos.db-wal")).then(
        (s) => s.size,
        () => 0,
      ),
    ).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}, 120_000);

it("enforces identity and authority policies over memory link and synchronizes profile/gates/grants", async () => {
  const db = new Db();
  const kernel = createKernel({
    db,
    store: createMemoryObjectStore(),
    build: "test",
    dev: true,
    testSeed: true,
  });
  const root = await connect(kernel, null);
  const ordinary = await connect(kernel, null);
  const invitee = await connect(kernel, null);
  try {
    await root.api.auth.device.register({});
    await root.api.auth.login({ pin: "123456" });
    await ordinary.api.auth.device.register({});
    const session = await ordinary.api.auth.login({ pin: "654321" });
    if (!("user" in session)) throw new Error("expected session");
    await expect(
      ordinary.api.identity.invitation.create({}),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await expect(
      ordinary.api.authority.access.set({
        user: session.user.id,
        roles: ["root"],
      }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await expect(
      ordinary.api.authority.grant.set({
        resource: "test:resource",
        principalType: "user",
        principal: session.user.id,
        level: "own",
      }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    const device = (await invitee.api.auth.device.register({})).device;
    const invitation = await root.api.identity.invitation.create({});
    const first = await invitee.api.auth.login({ pin: invitation.pin });
    if (!("onboarding" in first)) throw new Error("expected invitation");
    const onboard = await invitee.api.identity.onboarding.complete({
      invitationToken: first.invitationToken,
      pins: ["456789", "987654"],
      handle: "student_1",
      name: "学生一",
    });
    const updated = await invitee.api.identity.profile.update({
      name: "学生二",
    });
    expect(updated.user.name).toBe("学生二");
    await root.api.authority.access.set({
      user: onboard.user.id,
      roles: ["access_manager"],
      features: ["learning"],
    });
    const scope = `me:${onboard.user.id}`;
    const snapshot = await invitee.api.sync.pull({ cursors: {} });
    expect(
      snapshot.scopes[scope]!.rows.find((row) => row.type === "profile")!.data,
    ).toMatchObject({
      name: "学生二",
      roles: ["administrator", "access_manager"],
      features: ["learning"],
    });
    await expect(
      invitee.api.identity.invitation.create({}),
    ).resolves.toHaveProperty("pin");
    await root.api.authority.access.set({ user: onboard.user.id, roles: [] });
    await expect(
      invitee.api.identity.invitation.create({}),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    kernel.authority.setGrant({
      resource: "book:test",
      principalType: "user",
      principal: onboard.user.id,
      level: "own",
    });
    await invitee.api.authority.grant.set({
      resource: "book:test",
      principalType: "user",
      principal: session.user.id,
      level: "read",
    });
    const ordinaryScope = `me:${session.user.id}`;
    expect(
      (await ordinary.api.sync.pull({ cursors: {} })).scopes[
        ordinaryScope
      ]!.rows.some((row) => row.type === "grant"),
    ).toBe(true);
    const replacement = await invitee.api.identity.pins.replace({
      currentPin: "987654",
      pins: ["112233"],
    });
    expect(replacement.credentialVersion).toBeGreaterThan(
      onboard.credentialVersion!,
    );
    const afterReplacement = await invitee.api.sync.pull({
      cursors: { [scope]: snapshot.scopes[scope]!.cursor },
    });
    expect(
      afterReplacement.scopes[scope]!.rows.find(
        (row) => row.type === "profile",
      )!.data,
    ).toMatchObject({ credentialVersion: replacement.credentialVersion });
    await invitee.api.auth.logout({});
    await expect(
      invitee.api.auth.resume({ token: onboard.token }),
    ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
    await expect(
      invitee.api.auth.login({ pin: "456789" }),
    ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
    await invitee.api.auth.login({ pin: "112233" });
    db.run("UPDATE devices SET banned=1 WHERE id=?", device);
    await expect(
      invitee.api.identity.profile.update({ name: "禁止" }),
    ).rejects.toMatchObject({ code: "E_DENIED", data: { reason: "banned" } });
  } finally {
    root.client.stop();
    ordinary.client.stop();
    invitee.client.stop();
    await kernel.close();
    db.close();
  }
}, 60_000);

it("returns invalid-client over memory link for an unknown saved device and permits fresh registration", async () => {
  const db = new Db();
  const kernel = createKernel({
    db,
    store: createMemoryObjectStore(),
    build: "test",
    dev: true,
    testSeed: true,
  });
  const client = await connect(kernel, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
  try {
    await expect(
      client.api.auth.login({ pin: "123456" }),
    ).rejects.toMatchObject({
      code: "E_UNAUTHENTICATED",
      data: { reason: "invalid-client" },
    });
    await expect(
      client.api.auth.resume({ token: "a".repeat(64) }),
    ).rejects.toMatchObject({
      code: "E_UNAUTHENTICATED",
      data: { reason: "invalid-client" },
    });
    await expect(client.api.auth.device.register({})).resolves.toHaveProperty(
      "device",
    );
    await expect(
      client.api.auth.login({ pin: "123456" }),
    ).resolves.toHaveProperty("user");
  } finally {
    client.client.stop();
    await kernel.close();
    db.close();
  }
});

it("replays logout without revoking a session created after the original logout", async () => {
  const db = new Db();
  const kernel = createKernel({
    db,
    store: createMemoryObjectStore(),
    build: "test",
    dev: true,
    testSeed: true,
  });
  const current = await connect(kernel, null);
  try {
    await current.api.auth.device.register({});
    const original = await current.api.auth.login({ pin: "654321" });
    if (!("token" in original)) throw new Error("expected a session");
    const op = createUlid()();
    await current.api.auth.logout({ token: original.token }, { op });
    await expect(
      current.api.auth.resume({ token: original.token }),
    ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
    const newer = await current.api.auth.login({ pin: "654321" });
    if (!("token" in newer)) throw new Error("expected a session");
    await current.api.auth.logout({ token: original.token }, { op });
    // The replay conceals the current connection, while its newer saved login
    // remains resumable. It must not replay the original token revocation.
    await expect(current.api.sync.pull({ cursors: {} })).rejects.toMatchObject({
      code: "E_UNAUTHENTICATED",
    });
    await expect(
      current.api.auth.resume({ token: newer.token }),
    ).resolves.toMatchObject({ token: newer.token, user: newer.user });
    await expect(
      current.api.auth.resume({ token: original.token }),
    ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
  } finally {
    current.client.stop();
    await kernel.close();
    db.close();
  }
});

it("replays a login by operation id after reconnect: same session, connection re-bound, conflicting reuse rejected", async () => {
  const db = new Db();
  const kernel = createKernel({
    db,
    store: createMemoryObjectStore(),
    build: "test",
    dev: true,
    testSeed: true,
  });
  const first = await connect(kernel, null);
  let second: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    const { device } = await first.api.auth.device.register({});
    const op = createUlid()();
    const session = await first.api.auth.login({ pin: "654321" }, { op });
    if (!("token" in session)) throw new Error("expected a session");
    const sessions = db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sessions",
    );
    first.client.stop();
    // The reply was lost: the client reconnects and retries the same operation.
    second = await connect(kernel, device);
    await expect(second.api.sync.pull({ cursors: {} })).rejects.toMatchObject({
      code: "E_UNAUTHENTICATED",
    });
    const replayed = await second.api.auth.login({ pin: "654321" }, { op });
    expect(replayed).toEqual(session);
    await expect(second.api.sync.pull({ cursors: {} })).resolves.toHaveProperty(
      "scopes",
    );
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions")).toEqual(
      sessions,
    );
    await expect(
      second.api.auth.login({ pin: "123456" }, { op }),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });
  } finally {
    first.client.stop();
    second?.client.stop();
    await kernel.close();
    db.close();
  }
});
