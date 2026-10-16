import { OPS_ACTION_ROLES } from "@talos/contract";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { AppError, Emitter, deferred } from "@talos/base";
import { contract } from "@talos/contract";
import { LinkClient } from "@talos/link";
import type {
  ClientState,
  WelcomeHeader,
  CallOptions,
  CallResult,
} from "@talos/link";
import type { Database } from "@talos/store";
import { openAppDb } from "../platform/storage/database.ts";
import { ClientRuntime } from "./runtime.ts";
import { createPinVerifier } from "../core/auth/pin.ts";
import type { PinVerifier } from "../core/auth/pin.ts";
import type { SavedSession } from "../core/auth/session.ts";
const crypto = webcrypto as unknown as Crypto;
const user = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  name: "测试用户",
  handle: "test",
  roles: [],
  features: ["offline" as const],
};
const device = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const session = {
  user,
  token: "a".repeat(64),
  expires: 999999999,
  credentialVersion: 1,
};
let verifier: PinVerifier;
beforeAll(async () => {
  verifier = await createPinVerifier("654321", crypto);
});
class TestLink extends LinkClient {
  connected = false;
  stateEvents = new Emitter<ClientState>();
  welcomeEvents = new Emitter<WelcomeHeader>();
  calls: { method: string; args: unknown; options?: CallOptions }[] = [];
  handler?: (method: string, args: unknown, options?: CallOptions) => unknown;
  constructor() {
    super({
      connect: async () => {
        throw new AppError("E_OFFLINE", "offline");
      },
      hello: () => ({ v: 1, device: null, build: "test", lang: "zh-CN" }),
    });
  }
  override get state(): ClientState {
    return this.connected ? "open" : "stopped";
  }
  override start(): void {}
  interrupt(): void {
    this.connected = false;
    this.stateEvents.emit("waiting");
  }
  override stop(): void {
    this.connected = false;
    this.stateEvents.emit("stopped");
  }
  override onState(fn: (state: ClientState) => void): () => void {
    return this.stateEvents.on(fn);
  }
  override onWelcome(fn: (welcome: WelcomeHeader) => void): () => void {
    return this.welcomeEvents.on(fn);
  }
  override async call(
    method: string,
    args: unknown,
    options?: CallOptions,
  ): Promise<CallResult> {
    this.calls.push({ method, args, options });
    const custom = this.handler?.(method, args, options);
    if (custom !== undefined)
      return { data: await custom, body: new Uint8Array() };
    if (method === "auth.device.register")
      return { data: { device }, body: new Uint8Array() };
    if (method === "auth.resume" || method === "auth.login")
      return { data: session, body: new Uint8Array() };
    if (method === "sync.pull")
      return {
        data: { scopes: {}, gone: [], added: [] },
        body: new Uint8Array(),
      };
    throw new AppError("E_INVALID", "unexpected call");
  }
  connectNow(): void {
    this.connected = true;
    this.stateEvents.emit("open");
    this.welcomeEvents.emit({ v: 1, build: "test", device, now: 1, conn: "c" });
  }
}
const runtimes: ClientRuntime[] = [];
const databases: Database[] = [];
async function setup(saved = false) {
  const db = await openAppDb({
    indexedDB: new IDBFactory(),
    keyRange: IDBKeyRange,
    channel: null,
  });
  databases.push(db);
  await db.table<string, string>("session").put(device, "device");
  if (saved)
    await db
      .table<SavedSession, string>("session")
      .put({ ...session, verifier }, "active");
  const link = new TestLink();
  let now = 10_000;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 0;
  const runtime = new ClientRuntime({
    build: "test",
    production: false,
    db: async () => db,
    link: () => link,
    crypto,
    now: () => now,
    timers: {
      set: (fn, ms) => {
        timers.set(++next, { fn, ms });
        return next;
      },
      clear: (id) => {
        timers.delete(id as number);
      },
    },
  });
  runtimes.push(runtime);
  await runtime.start();
  return {
    runtime,
    db,
    link,
    timers,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((r) => r.close()));
  databases.splice(0).forEach((db) => db.close());
});
async function until(
  runtime: ClientRuntime,
  predicate: () => boolean,
): Promise<void> {
  if (predicate()) return;
  await new Promise<void>((resolve) => {
    const off = runtime.subscribe(() => {
      if (predicate()) {
        off();
        resolve();
      }
    });
  });
}
describe("client runtime session and commands", () => {
  it("starts signed out offline and explains that first login needs the server", async () => {
    const { runtime } = await setup();
    expect(runtime.getSnapshot().gate).toBe("signedOut");
    expect(await runtime.login("654321")).toBe(false);
    expect(runtime.getSnapshot().error).toBe(
      "此账户尚未在本机登录，请联网后首次登录",
    );
    expect(runtime.can(contract.me.setting.set)).toEqual({
      ok: false,
      reason: "请先登录",
    });
  });
  it("restores concealed, unlocks offline, locks immediately while preserving navigation", async () => {
    const { runtime, db, link } = await setup(true);
    expect(runtime.getSnapshot().gate).toBe("appLocked");
    expect(await runtime.login("654321")).toBe(true);
    runtime.dispatch({ type: "switchArea", area: "library" });
    runtime.lock();
    expect(runtime.getSnapshot().gate).toBe("appLocked");
    expect(runtime.getSnapshot().nav.area).toBe("library");
    expect(link.calls).toEqual([]);
    expect(runtime.can(contract.me.setting.set)).toEqual({
      ok: false,
      reason: "请先解锁",
    });
    expect(
      (await db.table<SavedSession, string>("session").get("active"))!.token,
    ).toBe(session.token);
  });
  it("offline settings are durable, optimistic and use the same operation key as the LWW register", async () => {
    const { runtime, db } = await setup(true);
    await runtime.login("654321");
    await runtime.setSetting("theme", "dark");
    expect(runtime.setting("theme", "light")).toBe("dark");
    expect(runtime.settingMark("theme")).toBe("pending");
    expect(runtime.getSnapshot().status.pending).toBe(1);
    const queue = await db
      .table<{ op: string; args: { value: { op: string } } }[], string>(
        "outbox",
      )
      .get(user.id);
    expect(queue![0]!.op).toBe(queue![0]!.args.value.op);
    expect(runtime.can(contract.tasks.cancel)).toEqual({
      ok: false,
      reason: "此操作需要连接服务器",
    });
  });
  it("wrong offline PIN persists throttle and cannot reveal content", async () => {
    const { runtime, db, advance } = await setup(true);
    await db
      .table<SavedSession, string>("session")
      .put({ ...session, verifier, failures: 4 }, "active");
    // The running session owns its own counter; exercise it rather than mutating its snapshot.
    for (let i = 0; i < 5; i++)
      expect(await runtime.login("000000")).toBe(false);
    expect(runtime.getSnapshot().error).toBe("尝试次数过多，请稍后再试");
    expect(await runtime.login("654321")).toBe(false);
    advance(31 * 60_000);
    expect(await runtime.login("000000")).toBe(false);
    expect(runtime.getSnapshot().error).toBe("PIN 不正确，请重试");
    expect(
      (await db.table<SavedSession, string>("session").get("active"))!.failures,
    ).toBe(1);
    expect(await runtime.login("654321")).toBe(true);
  });
  it("uses injected idle timer and setting zero disables it", async () => {
    const { runtime, timers } = await setup(true);
    await runtime.login("654321");
    const idle = [...timers.values()].find((t) => t.ms === 300_000)!;
    expect(idle).toBeDefined();
    idle.fn();
    expect(runtime.getSnapshot().gate).toBe("appLocked");
    await runtime.login("654321");
    await runtime.setSetting("idleLockMinutes", 0);
    expect([...timers.values()].some((t) => t.ms === 300_000)).toBe(false);
  });
  it("resumes on reconnect without unlocking and keeps connection live after lock", async () => {
    const { runtime, link } = await setup(true);
    link.connectNow();
    await until(
      runtime,
      () => runtime.getSnapshot().status.connection === "connected",
    );
    expect(link.calls.some((call) => call.method === "auth.resume")).toBe(true);
    expect(runtime.getSnapshot().gate).toBe("appLocked");
    await runtime.login("654321");
    runtime.lock();
    expect(runtime.getSnapshot().status.connection).toBe("connected");
    expect(link.calls.some((call) => call.method === "auth.lock")).toBe(false);
  });
  it("revoked session removes offline credential and requires login", async () => {
    const { runtime, link, db } = await setup(true);
    link.handler = (method) => {
      if (method === "auth.resume")
        throw new AppError("E_UNAUTHENTICATED", "revoked");
    };
    link.connectNow();
    await until(runtime, () => runtime.getSnapshot().gate === "signedOut");
    expect(await db.table("session").get("active")).toBeUndefined();
    expect(runtime.getSnapshot().user).toBeUndefined();
  });
  it("storage boot failure becomes a stable explanatory gate", async () => {
    const runtime = new ClientRuntime({
      build: "test",
      production: false,
      db: async () => {
        throw new AppError("E_BUSY", "请关闭其他标签页后重试");
      },
      link: () => new TestLink(),
    });
    runtimes.push(runtime);
    await runtime.start();
    expect(runtime.getSnapshot()).toMatchObject({
      gate: "signedOut",
      error: "请关闭其他标签页后重试",
    });
  });
});

describe("authentication race and privacy boundaries", () => {
  it.each(["resolve", "reject"] as const)(
    "a stale resume %s cannot replace or revoke a newer PIN login",
    async (outcome) => {
      const { runtime, link, db } = await setup(true);
      const pending = deferred<typeof session>();
      const newer = { ...session, token: "b".repeat(64) };
      link.handler = (method) =>
        method === "auth.resume"
          ? pending.promise
          : method === "auth.login"
            ? newer
            : undefined;
      link.connectNow();
      expect(await runtime.login("654321")).toBe(true);
      if (outcome === "resolve") pending.resolve(session);
      else
        pending.reject(new AppError("E_UNAUTHENTICATED", "expired old token"));
      const saved = await db
        .table<SavedSession, string>("session")
        .get("active");
      expect(saved!.token).toBe(newer.token);
      expect(runtime.getSnapshot().gate).toBe("app");
    },
  );
  it("Back/lock during an online PIN request wins over the later successful response", async () => {
    const { runtime, link } = await setup();
    const pending = deferred<typeof session>();
    link.handler = (method) =>
      method === "auth.login" ? pending.promise : undefined;
    link.connectNow();
    const login = runtime.login("654321");
    runtime.lock();
    pending.resolve(session);
    expect(await login).toBe(false);
    expect(runtime.getSnapshot().gate).toBe("appLocked");
    expect(runtime.getSnapshot().busy).toBe(false);
  });
  it("Back/lock during offline slow verification keeps content concealed", async () => {
    const { runtime } = await setup(true);
    const login = runtime.login("654321");
    runtime.lock();
    expect(await login).toBe(false);
    expect(runtime.getSnapshot().gate).toBe("appLocked");
  });
  it("disconnect fences an in-flight online login before saving or exposing its result", async () => {
    const { runtime, link, db } = await setup();
    const pending = deferred<typeof session>();
    link.handler = (method) =>
      method === "auth.login" ? pending.promise : undefined;
    link.connectNow();
    const login = runtime.login("654321");
    link.stop();
    pending.resolve(session);
    expect(await login).toBe(false);
    expect(runtime.getSnapshot().gate).toBe("signedOut");
    expect(await db.table("session").get("active")).toBeUndefined();
  });
  it("revocation clears all live projections and operation summaries while retaining durable user intent", async () => {
    const { runtime, link, db } = await setup(true);
    await runtime.login("654321");
    await runtime.setSetting("theme", "dark");
    runtime.dispatch({ type: "switchArea", area: "library" });
    runtime.lock();
    link.handler = (method) => {
      if (method === "auth.resume")
        throw new AppError("E_UNAUTHENTICATED", "revoked");
    };
    link.connectNow();
    await until(runtime, () => runtime.getSnapshot().gate === "signedOut");
    for (const repository of runtime.repositories.values())
      expect(repository.getSnapshot()).toEqual([]);
    expect(runtime.getSnapshot().status).toMatchObject({
      pending: 0,
      failed: 0,
      operations: [],
    });
    expect(runtime.getSnapshot().nav.area).toBe("chat");
    expect(runtime.settingMark("theme")).toBeUndefined();
    expect(await db.table("outbox").get(user.id)).toHaveLength(1);
  });
  it.each(["auth.resume", "auth.login"])(
    "%s E_LOCKED clears offline credentials and enters the admission gate",
    async (method) => {
      const { runtime, link, db } = await setup(true);
      if (method === "auth.resume") {
        link.handler = (name) => {
          if (name === method) throw new AppError("E_LOCKED", "设备已锁定");
        };
        link.connectNow();
        await until(
          runtime,
          () => runtime.getSnapshot().gate === "deviceLocked",
        );
      } else {
        link.connectNow();
        await until(
          runtime,
          () => runtime.getSnapshot().status.connection === "connected",
        );
        link.handler = (name) => {
          if (name === method) throw new AppError("E_LOCKED", "设备已锁定");
        };
        expect(await runtime.login("654321")).toBe(false);
      }
      expect(runtime.getSnapshot().gate).toBe("deviceLocked");
      expect(await db.table("session").get("active")).toBeUndefined();
      link.stop();
      expect(await runtime.login("654321")).toBe(false);
    },
  );
});
it("browser offline event closes the carrier immediately and permits cached PIN unlock", async () => {
  const { runtime, link } = await setup(true);
  link.connectNow();
  await until(
    runtime,
    () => runtime.getSnapshot().status.connection === "connected",
  );
  window.dispatchEvent(new Event("offline"));
  expect(link.connected).toBe(false);
  expect(runtime.getSnapshot().status.connection).toBe("offline");
  const calls = link.calls.length;
  expect(await runtime.login("654321")).toBe(true);
  expect(link.calls).toHaveLength(calls);
});
it("online-only commands wait for resume while queued preferences remain available", async () => {
  const { runtime, link } = await setup(true);
  await runtime.login("654321");
  const pending = deferred<typeof session>();
  link.handler = (method) =>
    method === "auth.resume" ? pending.promise : undefined;
  link.connectNow();
  expect(runtime.can(contract.tasks.cancel)).toEqual({
    ok: false,
    reason: "正在恢复会话，请稍后重试",
  });
  expect(runtime.can(contract.me.setting.set)).toEqual({ ok: true });
  pending.resolve(session);
  await until(
    runtime,
    () => runtime.getSnapshot().status.connection === "connected",
  );
  expect(runtime.can(contract.tasks.cancel)).toEqual({ ok: true });
});

describe("M9 identity lifecycle", () => {
  it("queues do-not-disturb offline and denies profile editing with a reason", async () => {
    const { runtime } = await setup(true);
    await runtime.login("654321");
    await runtime.setSetting("doNotDisturb", true);
    expect(runtime.setting("doNotDisturb", false)).toBe(true);
    expect(runtime.settingMark("doNotDisturb")).toBe("pending");
    expect(runtime.can(contract.identity.profile.update)).toEqual({
      ok: false,
      reason: "此操作需要连接服务器",
    });
  });
  it("logout calls the server then wipes session/verifiers while retaining all outboxes", async () => {
    const { runtime, db, link } = await setup(true);
    await runtime.login("654321");
    await runtime.setSetting("doNotDisturb", true);
    link.connectNow();
    await until(
      runtime,
      () => runtime.getSnapshot().status.connection === "connected",
    );
    link.handler = (method) =>
      method === "auth.logout" ? { ok: true } : undefined;
    await runtime.logout();
    expect(link.calls.some((call) => call.method === "auth.logout")).toBe(true);
    expect(await db.table("session").get("active")).toBeUndefined();
    expect(await db.table("outbox").get(user.id)).toHaveLength(1);
    expect(runtime.getSnapshot().gate).toBe("signedOut");
  });
  it("server logout failure keeps local credentials and cached account intact", async () => {
    const { runtime, db, link } = await setup(true);
    link.connectNow();
    await until(
      runtime,
      () => runtime.getSnapshot().status.connection === "connected",
    );
    await runtime.login("654321");
    link.handler = (method) => {
      if (method === "auth.logout")
        throw new AppError("E_DISCONNECTED", "连接中断");
    };
    await expect(runtime.logout()).rejects.toMatchObject({
      code: "E_DISCONNECTED",
    });
    expect(await db.table("session").get("active")).toBeDefined();
    expect(runtime.getSnapshot().gate).toBe("app");
  });
  it("late online resume keeps an already offline-unlocked account visible", async () => {
    const { runtime, link } = await setup(true);
    await runtime.login("654321");
    const pending = deferred<typeof session>();
    link.handler = (method) =>
      method === "auth.resume" ? pending.promise : undefined;
    link.connectNow();
    expect(runtime.getSnapshot().gate).toBe("app");
    pending.resolve(session);
    await until(
      runtime,
      () => runtime.getSnapshot().status.connection === "connected",
    );
    expect(runtime.getSnapshot().gate).toBe("app");
  });
  it("recognizes an invitation without caching it as a session", async () => {
    const { runtime, db, link } = await setup();
    link.handler = (method) =>
      method === "auth.login"
        ? { onboarding: true, invitationToken: "b".repeat(64) }
        : undefined;
    link.connectNow();
    expect(await runtime.login("123456")).toBe(true);
    expect(runtime.getSnapshot().gate).toBe("onboarding");
    expect(await db.table("session").get("active")).toBeUndefined();
  });
  it("PIN replacement removes all old local credentials and supports both replacement PINs offline", async () => {
    const { runtime, db, link } = await setup(true);
    link.connectNow();
    await until(
      runtime,
      () => runtime.getSnapshot().status.connection === "connected",
    );
    await runtime.login("654321");
    link.handler = (method) =>
      method === "identity.pins.replace"
        ? { ok: true, credentialVersion: 2 }
        : undefined;
    await runtime.replacePins("654321", ["111111", "222222"]);
    link.stop();
    runtime.lock();
    expect(
      (await db.table<SavedSession, string>("session").get("active"))!.verifier,
    ).toBeUndefined();
    expect(await runtime.login("654321")).toBe(false);
    expect(await runtime.login("111111")).toBe(true);
    runtime.lock();
    expect(await runtime.login("222222")).toBe(true);
  });
  it("counts queued and failed changes belonging to every cached user before reset", async () => {
    const { runtime, db } = await setup(true);
    await db.table("outbox").put([{}, {}], "first");
    await db.table("outbox").put([{}], "second");
    expect(await runtime.localOperationCount()).toBe(3);
  });
});
it("removes offline access when a resumed profile no longer has the offline feature", async () => {
  const { runtime, link } = await setup(true);
  link.handler = (method) =>
    method === "auth.resume"
      ? { ...session, user: { ...user, features: [] } }
      : undefined;
  link.connectNow();
  await until(
    runtime,
    () => runtime.getSnapshot().status.connection === "connected",
  );
  link.stop();
  expect(await runtime.login("654321")).toBe(false);
  expect(runtime.getSnapshot().gate).toBe("appLocked");
});
it.each([false, true])(
  "login without SubtleCrypto (secure random available: %s)",
  async (hasRandom) => {
    const db = await openAppDb({
      indexedDB: new IDBFactory(),
      keyRange: IDBKeyRange,
      channel: null,
    });
    databases.push(db);
    await db.table("session").put(device, "device");
    const link = new TestLink();
    const runtime = new ClientRuntime({
      build: "test",
      production: false,
      db: async () => db,
      link: () => link,
      crypto: (hasRandom
        ? { getRandomValues: crypto.getRandomValues.bind(crypto) }
        : {}) as Crypto,
    });
    runtimes.push(runtime);
    await runtime.start();
    link.connectNow();
    expect(await runtime.login("654321")).toBe(true);
    const saved = (await db
      .table<SavedSession, string>("session")
      .get("active"))!;
    if (hasRandom) expect(saved.verifier?.iterations).toBe(210_000);
    else expect(saved.verifier).toBeUndefined();
    link.stop();
    runtime.lock();
    if (hasRandom) {
      expect(await runtime.login("654320")).toBe(false);
      expect(await runtime.login("654321")).toBe(true);
    } else {
      expect(await runtime.login("654321")).toBe(false);
      expect(runtime.getSnapshot().error).toBe(
        "此账户尚未在本机登录，请联网后首次登录",
      );
    }
  },
);
it("a protected RPC admission denial conceals the app and removes its offline verifier", async () => {
  const { runtime, db, link } = await setup(true);
  link.connectNow();
  await until(
    runtime,
    () => runtime.getSnapshot().status.connection === "connected",
  );
  await runtime.login("654321");
  link.handler = (method) => {
    if (method === "identity.profile.update")
      throw new AppError("E_DENIED", "设备已封禁", { reason: "banned" });
  };
  await expect(runtime.updateProfile({ name: "新名称" })).rejects.toMatchObject(
    { code: "E_DENIED" },
  );
  expect(runtime.getSnapshot()).toMatchObject({
    gate: "deviceLocked",
    admission: { reason: "banned" },
  });
  expect(await db.table("session").get("active")).toBeUndefined();
});
it("a sync admission denial also leaves the app gate and clears credentials", async () => {
  const { runtime, db, link } = await setup(true);
  await runtime.login("654321");
  link.handler = (method) => {
    if (method === "sync.pull")
      throw new AppError("E_LOCKED", "系统已锁定", { reason: "system-lock" });
  };
  link.connectNow();
  await until(runtime, () => runtime.getSnapshot().gate === "deviceLocked");
  expect(runtime.getSnapshot().admission?.reason).toBe("system-lock");
  expect(await db.table("session").get("active")).toBeUndefined();
});

it("revoked protected sessions remove offline credentials while wrong current PIN preserves them", async () => {
  const { runtime, db, link } = await setup(true);
  link.connectNow();
  await until(
    runtime,
    () => runtime.getSnapshot().status.connection === "connected",
  );
  await runtime.login("654321");
  link.handler = (method) => {
    if (method === "identity.pins.replace")
      throw new AppError("E_UNAUTHENTICATED", "PIN 不正确", {
        reason: "invalid-pin",
      });
  };
  await expect(runtime.replacePins("000000", ["111111"])).rejects.toMatchObject(
    { code: "E_UNAUTHENTICATED" },
  );
  expect(runtime.getSnapshot().gate).toBe("app");
  expect(await db.table("session").get("active")).toBeDefined();
  link.handler = (method) => {
    if (method === "identity.profile.update")
      throw new AppError("E_UNAUTHENTICATED", "会话失效");
  };
  await expect(runtime.updateProfile({ name: "名字" })).rejects.toMatchObject({
    code: "E_UNAUTHENTICATED",
  });
  expect(runtime.getSnapshot().gate).toBe("signedOut");
  expect(await db.table("session").get("active")).toBeUndefined();
  link.stop();
  expect(await runtime.login("654321")).toBe(false);
});
it("denial retains only an online revoke token and logout sends it after detachment", async () => {
  const { runtime, db, link } = await setup(true);
  link.connectNow();
  await until(
    runtime,
    () => runtime.getSnapshot().status.connection === "connected",
  );
  await runtime.login("654321");
  link.handler = (method) => {
    if (method === "identity.profile.update")
      throw new AppError("E_LOCKED", "封禁", { reason: "banned" });
  };
  await expect(runtime.updateProfile({ name: "名字" })).rejects.toMatchObject({
    code: "E_LOCKED",
  });
  expect(await db.table("session").get("active")).toBeUndefined();
  expect(await db.table("session").get("revoke")).toEqual({
    token: session.token,
    name: user.name,
  });
  expect(runtime.getSnapshot().logoutName).toBe(user.name);
  link.handler = (method) =>
    method === "auth.logout" ? { ok: true } : undefined;
  await runtime.logout();
  expect(
    link.calls.filter((call) => call.method === "auth.logout")[0]?.args,
  ).toEqual({ token: session.token });
  expect(await db.table("session").get("revoke")).toBeUndefined();
});
it("retains both current PIN verifiers through online login but clears them after credential epoch changes", async () => {
  const { runtime, db, link } = await setup(true);
  link.connectNow();
  await until(
    runtime,
    () => runtime.getSnapshot().status.connection === "connected",
  );
  await runtime.login("654321");
  link.handler = (method) =>
    method === "identity.pins.replace"
      ? { ok: true, credentialVersion: 2 }
      : method === "auth.login"
        ? { ...session, credentialVersion: 2 }
        : undefined;
  await runtime.replacePins("654321", ["111111", "222222"]);
  runtime.lock();
  expect(await runtime.login("111111")).toBe(true);
  expect(
    (await db.table<SavedSession, string>("session").get("active"))!.verifiers,
  ).toHaveLength(2);
  link.stop();
  runtime.lock();
  expect(await runtime.login("222222")).toBe(true);
  link.handler = (method) =>
    method === "auth.resume" ? { ...session, credentialVersion: 3 } : undefined;
  link.connectNow();
  await until(
    runtime,
    () => runtime.getSnapshot().status.connection === "connected",
  );
  link.stop();
  runtime.lock();
  expect(await runtime.login("222222")).toBe(false);
  expect(
    (await db.table<SavedSession, string>("session").get("active"))!.verifiers,
  ).toBeUndefined();
});
it("stale queued failures cannot invalidate a newer login on the same account", async () => {
  const { runtime, db, link } = await setup(true);
  link.connectNow();
  await until(
    runtime,
    () => runtime.getSnapshot().status.connection === "connected",
  );
  await runtime.login("654321");
  const pending = deferred<{ ok: true }>();
  const began = deferred<void>();
  let first = true;
  link.handler = (method) => {
    if (method === "me.setting.set" && first) {
      first = false;
      began.resolve();
      return pending.promise;
    }
    if (method === "me.setting.set")
      return {
        setting: {
          id: "theme",
          key: "theme",
          value: {
            v: "dark",
            t: { ms: 1, counter: 0 },
            op: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
          },
        },
      };
  };
  await runtime.setSetting("theme", "dark");
  await began.promise;
  expect(await runtime.login("654321")).toBe(true);
  pending.reject(new AppError("E_UNAUTHENTICATED", "旧会话失效"));
  await db.table("session").get("active");
  expect(runtime.getSnapshot().gate).toBe("app");
  expect(await db.table("session").get("active")).toBeDefined();
});
it("queued authentication failure stops retrying and clears offline credentials", async () => {
  const { runtime, db, link, timers } = await setup(true);
  link.connectNow();
  await until(
    runtime,
    () => runtime.getSnapshot().status.connection === "connected",
  );
  await runtime.login("654321");
  link.handler = (method) => {
    if (method === "me.setting.set")
      throw new AppError("E_UNAUTHENTICATED", "会话已失效");
  };
  await runtime.setSetting("doNotDisturb", true);
  await until(runtime, () => runtime.getSnapshot().gate === "signedOut");
  expect(await db.table("session").get("active")).toBeUndefined();
  expect(
    link.calls.filter((call) => call.method === "me.setting.set"),
  ).toHaveLength(1);
  expect([...timers.values()]).toHaveLength(0);
  expect(await db.table("outbox").get(user.id)).toHaveLength(1);
});
it("stale cached profile credential epochs cannot erase a freshly authenticated PIN", async () => {
  const { runtime, db, link } = await setup(true);
  await db.table("rows").put({
    scope: `me:${user.id}`,
    type: "profile",
    id: user.id,
    rev: 1,
    deleted: false,
    data: { ...user, credentialVersion: 0 },
  });
  await db.table("kv").put([`me:${user.id}`], `scopes:${user.id}`);
  link.connectNow();
  await until(
    runtime,
    () => runtime.getSnapshot().status.connection === "connected",
  );
  expect(await runtime.login("654321")).toBe(true);
  link.stop();
  runtime.lock();
  expect(await runtime.login("654321")).toBe(true);
  expect(
    (await db.table<SavedSession, string>("session").get("active"))!
      .credentialVersion,
  ).toBe(1);
});

it.each(["conv", "coll"])(
  "purges revoked %s bodies/audio and file ownership while preserving staged drafts",
  async (kind) => {
    const { runtime, link, db } = await setup(true);
    await runtime.login("654321");
    link.connectNow();
    await until(
      runtime,
      () => runtime.getSnapshot().status.connection === "connected",
    );
    const conversation = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
    const scope = `${kind}:${conversation}`;
    link.handler = (method) =>
      method === "sync.pull"
        ? {
            scopes: { [scope]: { rows: [], cursor: 1, more: false } },
            gone: [],
            added: [scope],
          }
        : undefined;
    await runtime.sync();
    expect(runtime.hasScope(scope)).toBe(true);
    await runtime.setLocal(`${scope}:body:post`, "私密正文");
    await runtime.setLocal("text:pending", "未发送草稿");
    const bytes = new Uint8Array([1, 2, 3]);
    const { sha256Hex } = await import("@talos/base");
    const rid = sha256Hex(bytes);
    await runtime.saveFile(rid, bytes, `${scope}:cache`);
    expect(await runtime.readFile(rid)).toEqual(bytes);
    link.handler = (method) =>
      method === "sync.pull"
        ? { scopes: {}, gone: [scope], added: [] }
        : undefined;
    await runtime.sync();
    expect(runtime.hasScope(scope)).toBe(false);
    expect(
      await db
        .table("kv")
        .get(`feature:${runtime.getSnapshot().user!.id}:${scope}:body:post`),
    ).toBeUndefined();
    await expect(runtime.getLocal(`${scope}:body:post`)).rejects.toMatchObject({
      code: "E_DENIED",
    });
    await expect(
      runtime.setLocal(`${scope}:body:late`, "迟到的响应"),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await expect(
      runtime.saveFile(rid, bytes, `${scope}:late`),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await expect(
      runtime.retainFile(rid, `${scope}:late`),
    ).rejects.toMatchObject({
      code: "E_DENIED",
    });
    expect(await runtime.getLocal("text:pending")).toBe("未发送草稿");
    expect(await runtime.readFile(rid)).toBeUndefined();
    expect(await db.table("file_heads").get(rid)).toBeUndefined();
    expect(await db.table("session").get("active")).toBeDefined();
  },
);

it("uses synced roles for every ops capability and root-only management entry", async () => {
  const { runtime, link } = await setup();
  link.connectNow();
  await runtime.login("654321");
  await until(
    runtime,
    () => runtime.getSnapshot().status.connection === "connected",
  );
  const current = { ...runtime.getSnapshot().user! };
  runtime.getSnapshot().user = current;
  for (const role of [null, "administrator", "root"] as const) {
    current.roles = role
      ? ["administrator", ...(role === "root" ? ["root" as const] : [])]
      : [];
    expect(runtime.gate("ops").ok).toBe(role === "root");
    for (const methods of Object.values(contract.ops))
      for (const method of Object.values(methods))
        expect(runtime.can(method).ok).toBe(
          role === "root" ||
            (role === "administrator" &&
              OPS_ACTION_ROLES[method.name as keyof typeof OPS_ACTION_ROLES] ===
                "administrator"),
        );
  }
  link.interrupt();
  expect(runtime.can(contract.ops.backup.create)).toEqual({
    ok: false,
    reason: "此操作需要连接服务器",
  });
});

it("bounds concurrent binary reads and releases slots after errors", async () => {
  const { runtime, link } = await setup();
  link.connectNow();
  await runtime.login("654321");
  await until(
    runtime,
    () => runtime.getSnapshot().status.connection === "connected",
  );
  expect(runtime.can(contract.chat.file.fetch)).toEqual({ ok: true });
  const firstBatch = deferred<void>();
  const release = deferred<void>();
  let active = 0,
    peak = 0,
    started = 0;
  link.handler = (method) => {
    if (method !== "chat.file.fetch") return undefined;
    const request = ++started;
    peak = Math.max(peak, ++active);
    if (started === 4) firstBatch.resolve();
    return release.promise.then(() => {
      active--;
      if (request === 1) throw new AppError("E_NOT_FOUND", "图片缺失");
      return { size: 0, offset: 0, eof: true };
    });
  };
  const pending = Promise.allSettled(
    Array.from({ length: 20 }, () =>
      runtime.fetchBody(contract.chat.file.fetch, {
        rid: "a".repeat(64),
        offset: 0,
      }),
    ),
  );
  await firstBatch.promise;
  expect(started).toBe(4);
  release.resolve();
  const results = await pending;
  expect(peak).toBe(4);
  expect(started).toBe(20);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(19);
});

it("keeps offline PIN verification alive through disconnected retry transitions", async () => {
  const { runtime, link } = await setup(true);
  const unlocking = runtime.login("654321");
  link.stateEvents.emit("connecting");
  link.stateEvents.emit("waiting");
  expect(await unlocking).toBe(true);
  expect(runtime.getSnapshot().gate).toBe("app");
});

it("keeps root force-offline in memory without browser storage and rejects ordinary users", async () => {
  const { runtime, link } = await setup(true);
  await runtime.login("654321");
  expect(() => runtime.setDebugOffline(true)).toThrow("仅根管理员");
  link.handler = (method) =>
    method === "auth.resume"
      ? { ...session, user: { ...user, roles: ["root", "administrator"] } }
      : undefined;
  link.connectNow();
  await until(
    runtime,
    () => !!runtime.getSnapshot().user?.roles.includes("root"),
  );
  runtime.setDebugOffline(true);
  expect(runtime.isDebugOffline()).toBe(true);
  expect(link.connected).toBe(false);
  expect(runtime.getSnapshot().status.connection).toBe("offline");
  runtime.setDebugOffline(false);
  expect(runtime.isDebugOffline()).toBe(false);
  const fresh = await setup(true);
  expect(fresh.runtime.isDebugOffline()).toBe(false);
});
