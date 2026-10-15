import { describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { AppError } from "@talos/base";
import { PIN_FAILURE_LIMIT, PIN_THROTTLE_MS } from "@talos/contract";
import { SessionController } from "./controller.ts";
import type { SessionControllerPorts } from "./controller.ts";
import { createPinVerifier } from "./pin.ts";
import type { PinVerifier } from "./pin.ts";

const user = { id: "u1", name: "林同学", roles: [], features: ["offline"] };
const crypto = webcrypto as unknown as Crypto;
let verifier: PinVerifier;
async function pinVerifier() {
  return (verifier ??= await createPinVerifier("123456", crypto));
}

function setup(overrides: Record<string, unknown> = {}) {
  const published: Record<string, unknown>[] = [];
  const session = new Map<string, unknown>();
  const timers = {
    ids: 0,
    set: vi.fn(() => ++timers.ids),
    clear: vi.fn(),
  };
  const ports = {
    generation: 0,
    closed: false,
    status: vi.fn(),
    publish: vi.fn((patch: Record<string, unknown>) => {
      published.push(patch);
      Object.assign(ports.snapshot, patch);
    }),
    snapshot: {
      gate: "appLocked",
      busy: false,
      status: { update: { state: "none" } },
      user: { ...user, features: ["offline"] },
    },
    db: {
      table: () => ({
        get: async (k: string) => session.get(k),
        put: async (v: unknown, k: string) => void session.set(k, v),
        delete: async (k: string) => void session.delete(k),
      }),
      tx: async (_t: string[], _m: string, fn: (tx: unknown) => void) =>
        fn({
          table: () => ({
            delete: (k: string) => session.delete(k),
            put: (v: unknown, k: string) => session.set(k, v),
          }),
        }),
    },
    call: vi.fn(),
    command: vi.fn(),
    build: "b1",
    checkUpdate: vi.fn(async () => {}),
    report: vi.fn(),
    timers,
    repositories: new Map(),
    link: { state: "closed" },
    concealment: 0,
    now: () => 1_000,
    environment: { crypto, online: () => false, persist: vi.fn() },
    options: { crypto },
    prepareUser: vi.fn(async () => {}),
    navigationGuards: { conceal: vi.fn() },
    applyUpdate: vi.fn(async () => {}),
    setting: <T>(_k: string, fallback: T) => fallback,
    can: () => ({ ok: true }),
    ...overrides,
  } as unknown as SessionControllerPorts;
  return {
    controller: new SessionController(ports),
    ports,
    published,
    session,
    timers,
  };
}
const savedBase = { token: "t", user, credentialVersion: 1 };

describe("error routing", () => {
  it("signs out on E_UNAUTHENTICATED and falls back to a local error if clearing fails", async () => {
    const t = setup();
    t.controller.report(new AppError("E_UNAUTHENTICATED", "x"));
    await vi.waitFor(() =>
      expect(t.published.some((p) => p.gate === "signedOut")).toBe(true),
    );
    expect(t.session.has("active")).toBe(false);
    const broken = setup({
      db: {
        tx: async () => {
          throw new Error("idb");
        },
        table: () => ({ delete: async () => {} }),
      },
    });
    broken.controller.report(new AppError("E_UNAUTHENTICATED", "x"));
    await vi.waitFor(() =>
      expect(broken.published.at(-1)).toEqual({
        error: "无法清除本机登录状态，请重置本机数据",
      }),
    );
  });

  it("throttling keeps the session and only shows the lock gate", () => {
    const t = setup();
    t.controller.report(
      new AppError("E_RATE_LIMITED", "慢", { reason: "throttled", retryAt: 5 }),
    );
    expect(t.published[0]).toMatchObject({
      gate: "deviceLocked",
      admission: { reason: "throttled", retryAt: 5 },
    });
    expect(t.session.size).toBe(0);
  });

  it("other admission refusals drop the session but keep a revoke-only token", async () => {
    const t = setup({ saved: { ...savedBase } });
    t.controller.report(new AppError("E_DENIED", "封", { reason: "banned" }));
    await vi.waitFor(() =>
      expect(t.session.get("revoke")).toEqual({ token: "t", name: "林同学" }),
    );
    expect(t.session.has("active")).toBe(false);
    expect((t.ports as { saved?: unknown }).saved).toBeUndefined();
  });

  it("a closed controller or plain error only publishes a message", () => {
    const t = setup({ closed: true });
    t.controller.report(new AppError("E_UNAUTHENTICATED", "x"));
    expect(t.published).toEqual([{ error: "x" }]);
    t.controller.report(new Error("boom"));
    expect(t.published.at(-1)).toEqual({ error: "暂时无法保存，请重试" });
  });

  it("revocation by ban keeps retryAt, any other reason signs out", async () => {
    const t = setup({ saved: { ...savedBase } });
    t.controller.revoked({ reason: "banned", retryAt: 77 });
    await vi.waitFor(() =>
      expect(t.published.some((p) => p.gate === "deviceLocked")).toBe(true),
    );
    expect(t.published.find((p) => p.gate === "deviceLocked")).toMatchObject({
      admission: { reason: "banned", retryAt: 77 },
    });
    const u = setup({ saved: { ...savedBase } });
    u.controller.revoked(null);
    await vi.waitFor(() =>
      expect(u.published.some((p) => p.gate === "signedOut")).toBe(true),
    );
    expect(u.session.has("revoke")).toBe(false);
  });
});

describe("connection and resume", () => {
  const welcome = { build: "b1" } as never;
  it("registers a device once, then resumes and drops verifiers when credentials changed", async () => {
    const connect = vi.fn(async () => {});
    const t = setup({
      saved: {
        ...savedBase,
        verifier: await pinVerifier(),
        verifiers: [await pinVerifier()],
      },
      engine: { phase: vi.fn(), connect, close: vi.fn(), sideState: vi.fn() },
    });
    (t.ports.call as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ device: "dev" })
      .mockResolvedValueOnce({ token: "t2", user, credentialVersion: 2 });
    await t.controller.connected(welcome);
    expect(t.session.get("device")).toBe("dev");
    const saved = t.session.get("active") as {
      token: string;
      verifier?: unknown;
      verifiers?: unknown;
    };
    expect(saved).toMatchObject({ token: "t2" });
    expect(saved.verifier).toBeUndefined();
    expect(saved.verifiers).toBeUndefined();
    expect(connect).toHaveBeenCalledOnce();
    expect(t.ports.checkUpdate).not.toHaveBeenCalled();
  });

  it("keeps verifiers when the credential version is unchanged and checks updates on a new build", async () => {
    const t = setup({
      device: "dev",
      saved: { ...savedBase, verifiers: [await pinVerifier()] },
      engine: {
        phase: vi.fn(),
        connect: vi.fn(async () => {}),
        close: vi.fn(),
        sideState: vi.fn(),
      },
    });
    (t.ports.call as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      token: "t",
      user,
      credentialVersion: 1,
    });
    await t.controller.connected({ build: "newer" } as never);
    expect(
      (t.session.get("active") as { verifiers?: unknown[] }).verifiers,
    ).toHaveLength(1);
    expect(t.ports.checkUpdate).toHaveBeenCalledOnce();
  });

  it("rejects a resumed session for a different account and locks the device on E_DENIED", async () => {
    const t = setup({
      device: "dev",
      saved: { ...savedBase },
      engine: {
        phase: vi.fn(),
        connect: vi.fn(),
        close: vi.fn(),
        sideState: vi.fn(),
      },
    });
    (t.ports.call as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      token: "t",
      user: { ...user, id: "other" },
    });
    await expect(t.controller.connected(welcome)).rejects.toMatchObject({
      code: "E_PROTOCOL",
    });
    const denied = setup({
      device: "dev",
      saved: { ...savedBase },
      engine: {
        phase: vi.fn(),
        connect: vi.fn(),
        close: vi.fn(),
        sideState: vi.fn(),
      },
    });
    (denied.ports.call as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AppError("E_DENIED", "d"),
    );
    await denied.controller.connected(welcome);
    expect(denied.published.find((p) => p.gate)).toMatchObject({
      gate: "deviceLocked",
    });
    expect(denied.session.get("revoke")).toBeTruthy();
  });

  it("abandons a stale connection attempt superseded while resuming", async () => {
    const t = setup({
      device: "dev",
      saved: { ...savedBase },
      engine: {
        phase: vi.fn(),
        connect: vi.fn(async () => {}),
        close: vi.fn(),
        sideState: vi.fn(),
      },
    });
    (t.ports.call as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => {
        (t.ports as { generation: number }).generation++;
        return { token: "stale", user, credentialVersion: 1 };
      },
    );
    await t.controller.connected(welcome);
    expect(t.session.has("active")).toBe(false);
  });
});

describe("offline unlock", () => {
  it("counts failures, throttles at the limit and clears the block after it expires", async () => {
    const saved = {
      ...savedBase,
      verifier: await pinVerifier(),
      verifiers: [await pinVerifier()],
    };
    let clock = 1_000;
    const t = setup({ saved, now: () => clock });
    for (let i = 1; i < PIN_FAILURE_LIMIT; i++) {
      expect(await t.controller.login("000000")).toBe(false);
      expect(t.published.at(-2)).toMatchObject({
        error: "PIN 不正确，请重试",
      });
      expect((t.session.get("active") as { failures: number }).failures).toBe(
        i,
      );
    }
    expect(await t.controller.login("000000")).toBe(false);
    expect(t.session.get("active")).toMatchObject({
      failures: PIN_FAILURE_LIMIT,
      blockedUntil: clock + PIN_THROTTLE_MS,
    });
    // even the right PIN is refused while throttled, without verifying
    expect(await t.controller.login("123456")).toBe(false);
    expect(
      t.published.some(
        (p) =>
          (p.admission as { reason?: string } | undefined)?.reason ===
          "throttled",
      ),
    ).toBe(true);
    clock += PIN_THROTTLE_MS + 1;
    expect(await t.controller.login("123456")).toBe(true);
    expect(t.session.get("active")).toMatchObject({
      failures: 0,
      blockedUntil: 0,
    });
    expect(t.ports.snapshot.gate).toBe("app");
  });

  it("refuses a malformed PIN, a never-logged-in device and a device without offline entitlement", async () => {
    const empty = setup();
    expect(await empty.controller.login("12")).toBe(false);
    expect(empty.published.some((p) => p.error === "请输入六位 PIN")).toBe(
      true,
    );
    expect(await empty.controller.login("123456")).toBe(false);
    expect(
      empty.published.some(
        (p) =>
          typeof p.error === "string" &&
          (p.error as string).includes("尚未在本机登录"),
      ),
    ).toBe(true);
    const noOffline = setup({
      saved: { ...savedBase, verifiers: [await pinVerifier()] },
      snapshot: {
        gate: "appLocked",
        busy: false,
        status: { update: { state: "none" } },
        user: { ...user, features: [] },
      },
    });
    expect(await noOffline.controller.login("123456")).toBe(false);
    expect(
      noOffline.published.some(
        (p) =>
          typeof p.error === "string" &&
          (p.error as string).includes("暂不可用"),
      ),
    ).toBe(true);
  });

  it("ignores a login while busy or closed and conceals a login overtaken by a lock", async () => {
    const busy = setup();
    (busy.ports.snapshot as { busy: boolean }).busy = true;
    expect(await busy.controller.login("123456")).toBe(false);
    expect(busy.published).toEqual([]);
    const t = setup({
      saved: { ...savedBase, verifiers: [await pinVerifier()] },
      engine: { sideState: vi.fn() },
    });
    const pending = t.controller.login("123456");
    (t.ports as { concealment: number }).concealment++;
    expect(await pending).toBe(false);
    expect(t.ports.snapshot.gate).toBe("appLocked");
    expect(t.published.find((p) => p.gate === "appLocked")).toBeTruthy();
  });
});

describe("lock and idle", () => {
  it("lock conceals, bumps the concealment epoch and applies a ready update", () => {
    const t = setup({
      snapshot: {
        gate: "app",
        busy: false,
        status: { update: { state: "ready" } },
      },
      engine: { sideState: vi.fn() },
    });
    t.controller.lock("idle");
    expect(t.ports.navigationGuards.conceal).toHaveBeenCalledOnce();
    expect(t.ports.concealment).toBe(1);
    expect(t.published[0]).toMatchObject({
      gate: "appLocked",
      concealed: true,
      lockReason: "idle",
    });
    expect(t.ports.applyUpdate).toHaveBeenCalledOnce();
  });

  it("arms the idle timer only in the app gate with a positive finite setting, capped for setTimeout", () => {
    const base = {
      gate: "app",
      busy: false,
      status: { update: { state: "none" } },
    };
    for (const [gate, minutes, armed] of [
      ["app", 5, true],
      ["appLocked", 5, false],
      ["app", 0, false],
      ["app", Number.POSITIVE_INFINITY, false],
    ] as const) {
      const t = setup({ snapshot: { ...base, gate }, setting: () => minutes });
      t.controller.resetIdle();
      expect(t.timers.set).toHaveBeenCalledTimes(armed ? 1 : 0);
    }
    const huge = setup({ snapshot: base, setting: () => 1e9 });
    huge.controller.resetIdle();
    expect((huge.timers.set.mock.calls[0] as unknown[])[1]).toBe(2_147_483_647);
  });
});

describe("credential changes", () => {
  it("clears the old verifiers before deriving new ones and aborts if the session moved on", async () => {
    const t = setup({
      saved: { ...savedBase, verifiers: [await pinVerifier()], failures: 3 },
    });
    (t.ports.command as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      credentialVersion: 2,
    });
    await t.controller.replacePins("123456", ["654321"]);
    const saved = t.session.get("active") as {
      verifiers: unknown[];
      credentialVersion: number;
      failures: number;
    };
    expect(saved).toMatchObject({ credentialVersion: 2, failures: 0 });
    expect(saved.verifiers).toHaveLength(1);
    const stale = setup({
      saved: { ...savedBase, verifiers: [await pinVerifier()] },
    });
    (stale.ports.command as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => {
        (stale.ports as { generation: number }).generation++;
        return { credentialVersion: 3 };
      },
    );
    await stale.controller.replacePins("123456", ["654321"]);
    expect(stale.session.has("active")).toBe(false);
  });

  it("logout revokes remotely first and then clears local state; a superseded logout does nothing locally", async () => {
    const t = setup({ saved: { ...savedBase } });
    (t.ports.command as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
    await t.controller.logout();
    expect(t.ports.command).toHaveBeenCalledWith(expect.anything(), {
      token: "t",
    });
    expect(t.published.some((p) => p.gate === "signedOut")).toBe(true);
    const stale = setup({ saved: { ...savedBase } });
    (stale.ports.command as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => {
        (stale.ports as { generation: number }).generation++;
        return {};
      },
    );
    await stale.controller.logout();
    expect(stale.published).toEqual([]);
  });

  it("invitations need the capability and cannot be queued", async () => {
    const denied = setup({ can: () => ({ ok: false, reason: "无权" }) });
    await expect(denied.controller.createInvitation()).rejects.toMatchObject({
      code: "E_DENIED",
    });
    const queued = setup();
    (queued.ports.command as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      queued: "op",
    });
    await expect(queued.controller.createInvitation()).rejects.toMatchObject({
      code: "E_INTERNAL",
    });
  });

  it("role gates: root, administrator, invitation managers and feature entitlements", () => {
    const gate = (
      roles: string[],
      feature: Parameters<SessionController["gate"]>[0],
      features: string[] = [],
    ) =>
      setup({
        snapshot: {
          gate: "app",
          busy: false,
          user: { roles, features },
          status: { update: { state: "none" } },
        },
      }).controller.gate(feature).ok;
    expect(gate(["root"], "ops")).toBe(true);
    expect(gate(["administrator"], "ops")).toBe(false);
    expect(gate(["administrator"], "admin")).toBe(true);
    expect(gate(["access_manager"], "invitation")).toBe(true);
    expect(gate([], "invitation")).toBe(false);
    expect(
      setup({
        snapshot: {
          gate: "app",
          busy: false,
          status: { update: { state: "none" } },
        },
      }).controller.gate("admin"),
    ).toEqual({
      ok: false,
      reason: "请先登录",
    });
  });
});
