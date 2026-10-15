import { describe, expect, it, vi } from "vitest";
import { AppError } from "@talos/base";
import { UpdateController } from "./updates.ts";
import type { UpdateControllerPorts } from "./updates.ts";

function setup(
  overrides: {
    production?: boolean;
    gate?: string;
    start?: () => Promise<void>;
  } = {},
) {
  let onState: (state: unknown) => void = () => {};
  const installer = {
    install: vi.fn(async () => {}),
    apply: vi.fn(async () => {}),
  };
  const handle = {
    installer,
    start: vi.fn(overrides.start ?? (async () => {})),
    close: vi.fn(async () => {}),
  };
  const status = vi.fn();
  const report = vi.fn();
  const sideState = vi.fn();
  const environment = {
    boot: vi.fn((_build: string, cb: (s: unknown) => void) => {
      onState = cb;
      return handle;
    }),
    exposeInstaller: vi.fn(),
    manifest: vi.fn(async () => ({ build: "next" })),
    reload: vi.fn(),
  };
  const ports = {
    snapshot: { gate: overrides.gate ?? "app" },
    options: { production: overrides.production ?? true },
    environment,
    build: "current",
    status,
    report,
    engine: { sideState },
  } as unknown as UpdateControllerPorts;
  const controller = new UpdateController(ports);
  return {
    controller,
    ports,
    handle,
    installer,
    status,
    report,
    sideState,
    environment,
    emit: (s: unknown) => onState(s),
  };
}

describe("update activation", () => {
  it("never boots the service worker in development or while the boot gate is up", () => {
    for (const o of [{ production: false }, { gate: "boot" }]) {
      const t = setup(o);
      t.controller.stableGate();
      expect(t.environment.boot).not.toHaveBeenCalled();
    }
  });

  it("boots once, exposes the installer and maps installer state to status", () => {
    const t = setup();
    t.controller.stableGate();
    t.controller.stableGate();
    expect(t.environment.boot).toHaveBeenCalledOnce();
    expect(t.environment.exposeInstaller).toHaveBeenCalledWith(t.installer);
    t.emit({ kind: "ready", build: "next" });
    const patch = t.status.mock.calls.at(-1)![0] as {
      update: { state: string; apply: () => void };
    };
    expect(patch.update.state).toBe("ready");
    // the ready state the page is already running is not offered as an update
    t.emit({ kind: "ready", build: "current" });
    expect(t.status.mock.calls.at(-1)![0]).toEqual({
      update: { state: "none", message: "离线内容已就绪" },
    });
  });

  it("surfaces a boot failure as a status message, keeping AppError text", async () => {
    const a = setup({
      start: async () => {
        throw new AppError("E_OFFLINE", "离线");
      },
    });
    a.controller.stableGate();
    await vi.waitFor(() =>
      expect(a.status).toHaveBeenCalledWith({
        update: { state: "none", message: "离线" },
      }),
    );
    const b = setup({
      start: async () => {
        throw new Error("boom");
      },
    });
    b.controller.stableGate();
    await vi.waitFor(() =>
      expect(b.status).toHaveBeenCalledWith({
        update: { state: "none", message: "暂时无法检查更新" },
      }),
    );
  });

  it("applies in order: freeze sync side state, install swap, then reload", async () => {
    const t = setup();
    t.controller.stableGate();
    const order: string[] = [];
    t.sideState.mockImplementation(() => order.push("freeze"));
    t.installer.apply.mockImplementation(async () => void order.push("apply"));
    t.environment.reload.mockImplementation(() => order.push("reload"));
    await t.controller.applyUpdate();
    expect(order).toEqual(["freeze", "apply", "reload"]);
    expect(t.sideState).toHaveBeenCalledWith(true, true);
  });

  it("does not reload when applying fails, and the status apply hook reports it", async () => {
    const t = setup();
    t.controller.stableGate();
    t.installer.apply.mockRejectedValueOnce(new Error("swap failed"));
    await expect(t.controller.applyUpdate()).rejects.toThrow("swap failed");
    expect(t.environment.reload).not.toHaveBeenCalled();
    t.installer.apply.mockRejectedValueOnce(new Error("swap failed"));
    t.emit({ kind: "ready", build: "next" });
    const apply = (
      t.status.mock.calls.at(-1)![0] as { update: { apply: () => void } }
    ).update.apply;
    apply();
    await vi.waitFor(() => expect(t.report).toHaveBeenCalledOnce());
  });

  it("coalesces concurrent update checks and allows the next one afterwards", async () => {
    const t = setup();
    t.controller.stableGate();
    let release!: () => void;
    t.installer.install.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const first = t.controller.checkUpdate();
    const second = t.controller.checkUpdate();
    await vi.waitFor(() => expect(t.installer.install).toHaveBeenCalledOnce());
    release();
    await Promise.all([first, second]);
    expect(t.installer.install).toHaveBeenCalledOnce();
    await t.controller.checkUpdate();
    expect(t.installer.install).toHaveBeenCalledTimes(2);
  });

  it("a failing check releases the coalescing slot", async () => {
    const t = setup();
    t.controller.stableGate();
    t.installer.install.mockRejectedValueOnce(new Error("offline"));
    await expect(t.controller.checkUpdate()).rejects.toThrow("offline");
    await t.controller.checkUpdate();
    expect(t.installer.install).toHaveBeenCalledTimes(2);
  });

  it("is inert before the stable gate", async () => {
    const t = setup();
    await t.controller.checkUpdate();
    await t.controller.applyUpdate();
    expect(t.sideState).not.toHaveBeenCalled();
    expect(t.environment.reload).not.toHaveBeenCalled();
  });
});
