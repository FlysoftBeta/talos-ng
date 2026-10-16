import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, deferred } from "@talos/base";
import { defineMethod, OP_RETENTION_MS, z } from "@talos/contract";
import { createMemoryCarrierPair, LinkClient } from "@talos/link";
import { Db } from "../persistence/db.ts";
import { Uow } from "../persistence/uow.ts";
import { LinkHost } from "./link-host.ts";
import type { LinkHostOptions } from "./link-host.ts";
const op = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
let cleanups: (() => void)[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  cleanups = [];
});
afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  vi.useRealTimers();
});
const tick = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(1);
};
function method(
  name = "test.echo",
  auth: "public" | "device" | "user" = "user",
  offline: "online" | "queue" = "online",
) {
  return defineMethod({
    name,
    auth,
    offline,
    args: z.object({ value: z.number() }).strict(),
    result: z.object({ value: z.number().nonnegative() }).strict(),
  });
}
function setup(options: Partial<LinkHostOptions> = {}, path?: string) {
  const db = new Db(path);
  const committed = vi.fn();
  const uow = new Uow(db, { committed });
  const incidents = vi.fn(() => "incident");
  const host = new LinkHost({
    db,
    uow,
    build: "test",
    authenticate: () => ({ device: "device", user: "user" }),
    reportIncident: incidents,
    ...options,
  });
  cleanups.push(
    () => db.close(),
    () => host.close(),
  );
  return { db, uow, host, incidents, committed };
}
async function connect(host: LinkHost): Promise<LinkClient> {
  const client = new LinkClient({
    hello: () => ({ v: 1, build: "test", device: "device", lang: "zh-CN" }),
    connect: async () => {
      const pair = createMemoryCarrierPair();
      host.link.accept(pair.b, {});
      return pair.a;
    },
  });
  cleanups.push(() => client.stop());
  client.start();
  await tick();
  expect(client.state).toBe("open");
  return client;
}
describe("LinkHost middleware", () => {
  it("enforces public/device/user levels before invoking handlers", async () => {
    let auth: { device?: string; user?: string } = {};
    const s = setup({ authenticate: () => auth });
    const handler = vi.fn((_context: unknown, args: { value: number }) => args);
    for (const level of ["public", "device", "user"] as const)
      s.host.register(method(`test.${level}`, level), handler);
    const client = await connect(s.host);
    const publicCall = client.call("test.public", { value: 1 });
    await tick();
    expect((await publicCall).data).toEqual({ value: 1 });
    const deniedDevice = expect(
      client.call("test.device", { value: 1 }),
    ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
    await tick();
    await deniedDevice;
    auth = { device: "device" };
    const deviceCall = client.call("test.device", { value: 2 });
    await tick();
    expect((await deviceCall).data).toEqual({ value: 2 });
    const deniedUser = expect(
      client.call("test.user", { value: 1 }),
    ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
    await tick();
    await deniedUser;
    auth = { device: "device", user: "user" };
    const userCall = client.call("test.user", { value: 3 });
    await tick();
    expect((await userCall).data).toEqual({ value: 3 });
    expect(handler).toHaveBeenCalledTimes(3);
  });
  it("rejects unknown methods, malformed arguments and unexpected bodies", async () => {
    const s = setup();
    const handler = vi.fn((_context: unknown, args: { value: number }) => args);
    s.host.register(method(), handler);
    const client = await connect(s.host);
    const checks = [
      expect(client.call("test.missing", {})).rejects.toMatchObject({
        code: "E_NOT_FOUND",
      }),
      expect(client.call("test.echo", { value: "bad" })).rejects.toMatchObject({
        code: "E_INVALID",
      }),
      expect(
        client.call("test.echo", { value: 1, admin: true }),
      ).rejects.toMatchObject({ code: "E_INVALID" }),
      expect(
        client.call("test.echo", { value: 1 }, { body: new Uint8Array([1]) }),
      ).rejects.toMatchObject({ code: "E_INVALID" }),
    ];
    await tick();
    await Promise.all(checks);
    expect(handler).not.toHaveBeenCalled();
  });
  it("reports invalid results and unexpected failures as incidents", async () => {
    const s = setup();
    s.host.register(method("test.invalid"), () => ({ value: -1 }));
    s.host.register(method("test.throw"), () => {
      throw new Error("sensitive database details");
    });
    const client = await connect(s.host);
    const invalid = expect(
      client.call("test.invalid", { value: 1 }),
    ).rejects.toMatchObject({
      code: "E_INTERNAL",
      data: { incidentId: "incident" },
    });
    const broken = expect(
      client.call("test.throw", { value: 1 }),
    ).rejects.toMatchObject({ code: "E_INTERNAL" });
    await tick();
    await Promise.all([invalid, broken]);
    expect(s.incidents).toHaveBeenCalledTimes(2);
  });
  it("runs the rate-limit hook before handler and replay", async () => {
    let allowed = true;
    const rateLimit = vi.fn(() => {
      if (!allowed) throw new AppError("E_RATE_LIMITED", "稍后重试");
    });
    const s = setup({ rateLimit });
    const handler = vi.fn((_context: unknown, args: { value: number }) => args);
    s.host.register(method(), handler);
    const client = await connect(s.host);
    const first = client.call("test.echo", { value: 1 }, { op });
    await tick();
    await first;
    allowed = false;
    const replay = expect(
      client.call("test.echo", { value: 1 }, { op }),
    ).rejects.toMatchObject({ code: "E_RATE_LIMITED" });
    await tick();
    await replay;
    expect(rateLimit).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledOnce();
  });
  it("coalesces concurrent operation replays and rejects conflicting payloads", async () => {
    const replay = vi.fn();
    const s = setup({ replay });
    const work = deferred<{ value: number }>();
    const handler = vi.fn(() => work.promise);
    s.host.register(method(), handler);
    const firstClient = await connect(s.host);
    const secondClient = await connect(s.host);
    const first = firstClient.call("test.echo", { value: 4 }, { op });
    const second = secondClient.call("test.echo", { value: 4 }, { op });
    const conflict = expect(
      secondClient.call("test.echo", { value: 5 }, { op }),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });
    await tick();
    await conflict;
    expect(handler).toHaveBeenCalledOnce();
    work.resolve({ value: 9 });
    await tick();
    expect((await first).data).toEqual({ value: 9 });
    expect((await second).data).toEqual({ value: 9 });
    expect(replay).toHaveBeenCalledOnce();
    const stored = secondClient.call("test.echo", { value: 4 }, { op });
    await tick();
    expect((await stored).data).toEqual({ value: 9 });
    expect(handler).toHaveBeenCalledOnce();
    expect(replay).toHaveBeenCalledTimes(2);
  });
  it("isolates replay identities by authenticated user", async () => {
    let user = "one";
    const s = setup({ authenticate: () => ({ device: "device", user }) });
    let count = 0;
    s.host.register(method(), () => ({ value: ++count }));
    const client = await connect(s.host);
    const first = client.call("test.echo", { value: 1 }, { op });
    await tick();
    expect((await first).data).toEqual({ value: 1 });
    user = "two";
    const second = client.call("test.echo", { value: 1 }, { op });
    await tick();
    expect((await second).data).toEqual({ value: 2 });
  });
  it("rolls back a queued mutation, revision, effects and op when result validation fails", async () => {
    const s = setup();
    s.db.exec(
      "CREATE TABLE counter(value INTEGER NOT NULL) STRICT; INSERT INTO counter VALUES(0)",
    );
    const effect = vi.fn();
    s.host.register(method("test.write", "user", "queue"), () =>
      s.uow.write((ctx) => {
        s.db.run("UPDATE counter SET value=value+1");
        ctx.afterCommit(effect);
        return { value: -1 };
      }),
    );
    const client = await connect(s.host);
    const failure = expect(
      client.call("test.write", { value: 1 }, { op }),
    ).rejects.toMatchObject({ code: "E_INTERNAL" });
    await tick();
    await failure;
    expect(
      s.db.get<{ value: number }>("SELECT value FROM counter")?.value,
    ).toBe(0);
    expect(
      s.db.get<{ count: number }>("SELECT count(*) AS count FROM ops")?.count,
    ).toBe(0);
    expect(s.uow.revision).toBe(0);
    expect(effect).not.toHaveBeenCalled();
    expect(s.committed).not.toHaveBeenCalled();
  });
  it("commits queued mutation and dedupe row in the same unit of work", async () => {
    const s = setup();
    s.db.exec(
      "CREATE TABLE counter(value INTEGER NOT NULL) STRICT; INSERT INTO counter VALUES(0)",
    );
    s.host.register(method("test.write", "user", "queue"), () =>
      s.uow.write(() => {
        s.db.run("UPDATE counter SET value=value+1");
        return { value: 1 };
      }),
    );
    const client = await connect(s.host);
    for (let i = 0; i < 2; i++) {
      const call = client.call("test.write", { value: 1 }, { op });
      await tick();
      await call;
    }
    expect(
      s.db.get<{ value: number }>("SELECT value FROM counter")?.value,
    ).toBe(1);
    expect(
      s.db.get<{ count: number }>("SELECT count(*) AS count FROM ops")?.count,
    ).toBe(1);
    expect(s.uow.revision).toBe(1);
    expect(s.committed).toHaveBeenCalledOnce();
  });
  it("runs batched queued operations independently with per-operation idempotency", async () => {
    const s = setup();
    s.db.exec(
      "CREATE TABLE counter(value INTEGER NOT NULL) STRICT; INSERT INTO counter VALUES(0)",
    );
    s.host.register(method("test.write", "user", "queue"), (_context, args) =>
      s.uow.write(() => {
        if (args.value < 0) throw new AppError("E_DENIED", "denied");
        s.db.run("UPDATE counter SET value=value+?", args.value);
        return { value: args.value };
      }),
    );
    s.host.register(method("test.online"), (_context, args) => args);
    const client = await connect(s.host);
    const other = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
    const push = async (ops: unknown[]) => {
      const call = client.call("sync.push", { ops });
      await tick();
      return (await call).data as { results: unknown[] };
    };
    const batch = [
      { op, method: "test.write", args: { value: 1 } },
      { op: other, method: "test.write", args: { value: -1 } },
      { op: "online", method: "test.online", args: { value: 2 } },
      { op: "bad", method: "test.write", args: { value: "x" } },
    ];
    const expected = {
      results: [
        { op },
        { op: other, error: { code: "E_DENIED", message: "denied" } },
        { op: "online", error: expect.objectContaining({ code: "E_INVALID" }) },
        { op: "bad", error: expect.objectContaining({ code: "E_INVALID" }) },
      ],
    };
    expect(await push(batch)).toEqual(expected);
    // A replayed batch after a lost reply applies nothing twice.
    expect(await push(batch)).toEqual(expected);
    expect(
      s.db.get<{ value: number }>("SELECT value FROM counter")?.value,
    ).toBe(1);
    expect(s.committed).toHaveBeenCalledOnce();
  });
  it("retains operation replies for fourteen days and permits execution after expiry", async () => {
    const s = setup();
    let count = 0;
    s.host.register(method(), () => ({ value: ++count }));
    const client = await connect(s.host);
    const first = client.call("test.echo", { value: 1 }, { op });
    await tick();
    await first;
    const created = s.db.get<{ created: number }>(
      "SELECT created FROM ops",
    )!.created;
    vi.setSystemTime(created + OP_RETENTION_MS);
    expect(s.host.sweepOps()).toBe(0);
    vi.setSystemTime(created + OP_RETENTION_MS + 1);
    expect(s.host.sweepOps()).toBe(1);
    const next = client.call("test.echo", { value: 1 }, { op });
    await tick();
    expect((await next).data).toEqual({ value: 2 });
  });
  it("replays a committed operation after database and host restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "talos-ops-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "test.sqlite");
    const first = setup({}, path);
    let count = 0;
    first.host.register(method(), () => ({ value: ++count }));
    const client = await connect(first.host);
    const call = client.call("test.echo", { value: 1 }, { op });
    await tick();
    await call;
    client.stop();
    first.host.close();
    first.db.close();
    const second = setup({}, path);
    second.host.register(method(), () => ({ value: ++count }));
    const restored = await connect(second.host);
    const replay = restored.call("test.echo", { value: 1 }, { op });
    await tick();
    expect((await replay).data).toEqual({ value: 1 });
    expect(count).toBe(1);
  });
});

it("drains accepted work, rejects new calls and bounds uncooperative shutdown to ten seconds", async () => {
  const s = setup();
  const gate = deferred<{ value: number }>();
  s.host.register(method(), () => gate.promise);
  const client = await connect(s.host);
  const pending = client.call("test.echo", { value: 1 }, { op });
  const rejected = expect(pending).rejects.toMatchObject({
    code: "E_DISCONNECTED",
  });
  await tick();
  let drained = false;
  const draining = s.host.drain().then(() => {
    drained = true;
  });
  const denied = expect(
    client.call("test.echo", { value: 2 }),
  ).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
  await tick();
  await denied;
  expect(drained).toBe(false);
  await vi.advanceTimersByTimeAsync(9998);
  expect(drained).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await draining;
  s.host.close();
  await tick();
  await rejected;
  gate.resolve({ value: 1 });
  await tick();
  expect(
    s.db.get<{ count: number }>("SELECT count(*) AS count FROM ops")?.count,
  ).toBe(0);
});

describe("binary result contracts", () => {
  it("validates, transports, and replays an identical binary result", async () => {
    const s = setup();
    const spec = defineMethod({
      name: "test.binary",
      auth: "user",
      offline: "online",
      body: "out",
      args: z.object({}),
      result: z.object({ size: z.number().int() }),
    });
    const handler = vi.fn(() => ({
      data: { size: 3 },
      body: new Uint8Array([0, 128, 255]),
    }));
    s.host.registerBody(spec, handler);
    const client = await connect(s.host);
    for (let n = 0; n < 2; n++) {
      const call = client.call(spec.name, {}, { op });
      await tick();
      expect(await call).toMatchObject({
        data: { size: 3 },
        body: new Uint8Array([0, 128, 255]),
      });
    }
    expect(handler).toHaveBeenCalledOnce();
  });
  it("rejects oversized binary replies and undeclared binary registration", async () => {
    const s = setup();
    expect(() =>
      s.host.registerBody(method(), () => ({
        data: { value: 1 },
        body: new Uint8Array(),
      })),
    ).toThrow(AppError);
    const spec = defineMethod({
      name: "test.oversize",
      auth: "user",
      offline: "online",
      body: "out",
      args: z.object({}),
      result: z.object({ size: z.number() }),
    });
    s.host.registerBody(spec, () => ({
      data: { size: 524289 },
      body: new Uint8Array(524289),
    }));
    const client = await connect(s.host);
    const check = expect(client.call(spec.name, {})).rejects.toMatchObject({
      code: "E_INTERNAL",
    });
    await tick();
    await check;
  });
});
