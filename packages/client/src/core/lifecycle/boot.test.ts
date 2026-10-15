import { describe, expect, it, vi } from "vitest";
import { AppError } from "@talos/base";
import type {
  Installer,
  InstallerState,
  ShellManifest,
  ShellStatus,
} from "@talos/shell";
import { createBoot } from "./boot.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(active: string | null = "current") {
  const events: string[] = [];
  const state: ShellStatus = {
    active,
    pending: null,
    previous: null,
    bootAttempts: 0,
    builds: [],
  };
  const manifest: ShellManifest = { build: "current", assets: [] };
  const installer: Installer = {
    status: vi.fn(async () => {
      events.push("status");
      return state;
    }),
    confirmBoot: vi.fn(async () => {
      events.push("confirm");
    }),
    install: vi.fn(async () => {
      events.push("install");
    }),
    apply: vi.fn(async () => undefined),
    getState: () => ({ kind: "none" }),
    close: vi.fn(async () => {
      events.push("close");
    }),
  };
  const register = vi.fn(async () => {
    events.push("register");
  });
  const navigator = {
    onLine: true,
    serviceWorker: { register, ready: Promise.resolve() },
  };
  const fetch = vi.fn(async (_input: string | Request, init?: RequestInit) => {
    void _input;
    void init;
    events.push("fetch");
    return new Response(JSON.stringify(manifest), {
      headers: { "Content-Type": "application/json" },
    });
  });
  const onState = vi.fn<(state: InstallerState) => void>();
  const options = {
    build: "current",
    onState,
    environment: { navigator, fetch, installer },
  };
  return {
    options,
    installer,
    navigator,
    fetch,
    register,
    events,
    state,
    onState,
  };
}

describe("background shell boot", () => {
  it("does no work until explicitly started after rendering", async () => {
    const f = fixture();
    const boot = createBoot(f.options);
    expect(f.events).toEqual([]);
    await boot.close();
    expect(f.events).toEqual(["close"]);
  });
  it("confirms cached startup before any service worker or network operation", async () => {
    const f = fixture();
    const boot = createBoot(f.options);
    await boot.start();
    expect(f.events).toEqual([
      "status",
      "confirm",
      "register",
      "fetch",
      "install",
      "status",
      "confirm",
    ]);
    expect(f.onState).toHaveBeenCalledWith({ kind: "ready", build: "current" });
    await boot.close();
  });
  it("confirms a cached offline boot without registration, ready or fetch", async () => {
    const f = fixture();
    f.navigator.onLine = false;
    f.navigator.serviceWorker.ready = new Promise(() => undefined);
    const boot = createBoot(f.options);
    await boot.start();
    expect(f.events).toEqual(["status", "confirm"]);
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.register).not.toHaveBeenCalled();
    await boot.close();
  });
  it("reports missing cached content offline without network requests", async () => {
    const f = fixture(null);
    f.navigator.onLine = false;
    const boot = createBoot(f.options);
    await expect(boot.start()).rejects.toMatchObject({ code: "E_OFFLINE" });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.installer.confirmBoot).not.toHaveBeenCalled();
    await boot.close();
  });
  it("does not confirm a different active build", async () => {
    const f = fixture("other");
    const boot = createBoot(f.options);
    await boot.start();
    expect(f.installer.confirmBoot).not.toHaveBeenCalled();
    await boot.close();
  });
  it("confirms first installation after it becomes active", async () => {
    const f = fixture(null);
    vi.mocked(f.installer.status)
      .mockResolvedValueOnce(f.state)
      .mockResolvedValueOnce({ ...f.state, active: "current" });
    const boot = createBoot(f.options);
    await boot.start();
    expect(f.events.indexOf("install")).toBeLessThan(
      f.events.indexOf("confirm"),
    );
    expect(f.installer.confirmBoot).toHaveBeenCalledTimes(1);
    await boot.close();
  });
  it("deduplicates start and close calls", async () => {
    const f = fixture();
    const boot = createBoot(f.options);
    expect(boot.start()).toBe(boot.start());
    await boot.start();
    expect(boot.close()).toBe(boot.close());
    await boot.close();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.installer.close).toHaveBeenCalledTimes(1);
    await expect(boot.start()).rejects.toMatchObject({ code: "E_CANCELLED" });
  });
  it("stops cleanly while registration never settles", async () => {
    const f = fixture();
    const entered = deferred<void>();
    const pending = deferred<void>();
    f.register.mockImplementation(() => {
      entered.resolve();
      return pending.promise;
    });
    const boot = createBoot(f.options);
    const result = boot.start().catch((error: unknown) => error);
    await entered.promise;
    await boot.close();
    expect(await result).toMatchObject({ code: "E_CANCELLED" });
    expect(f.installer.close).toHaveBeenCalledTimes(1);
    expect(f.fetch).not.toHaveBeenCalled();
    pending.resolve();
    await Promise.resolve();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("stops cleanly while service worker ready never settles", async () => {
    const f = fixture();
    const entered = deferred<void>();
    f.navigator.serviceWorker.ready = new Promise(() => undefined);
    f.register.mockImplementation(async () => {
      entered.resolve();
    });
    const boot = createBoot(f.options);
    const result = boot.start().catch((error: unknown) => error);
    await entered.promise;
    await boot.close();
    expect(await result).toMatchObject({ code: "E_CANCELLED" });
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("aborts a pending fetch and ignores its late completion", async () => {
    const f = fixture();
    const entered = deferred<void>();
    const pending = deferred<Response>();
    f.fetch.mockImplementation((_input, init) => {
      expect(init?.signal?.aborted).toBe(false);
      entered.resolve();
      return pending.promise;
    });
    const boot = createBoot(f.options);
    const result = boot.start().catch((error: unknown) => error);
    await entered.promise;
    await boot.close();
    expect(await result).toMatchObject({ code: "E_CANCELLED" });
    expect(f.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    pending.resolve(new Response("{}"));
    await Promise.resolve();
    expect(f.installer.install).not.toHaveBeenCalled();
  });
  it("cancels installation before closing its database connection", async () => {
    const f = fixture();
    const entered = deferred<void>();
    vi.mocked(f.installer.install).mockImplementation(
      async (_manifest, options) =>
        new Promise((resolve) => {
          options?.signal?.addEventListener("abort", () => {
            f.events.push("aborted");
            resolve();
          });
          entered.resolve();
        }),
    );
    const boot = createBoot(f.options);
    const result = boot.start().catch((error: unknown) => error);
    await entered.promise;
    await boot.close();
    expect(await result).toMatchObject({ code: "E_CANCELLED" });
    expect(f.events.indexOf("aborted")).toBeLessThan(f.events.indexOf("close"));
  });
  it("does not fetch if connectivity becomes offline during registration", async () => {
    const f = fixture();
    f.register.mockImplementation(async () => {
      f.navigator.onLine = false;
    });
    const boot = createBoot(f.options);
    await boot.start();
    expect(f.fetch).not.toHaveBeenCalled();
    await boot.close();
  });
  it("uses no-store and an abort signal for manifest fetch", async () => {
    const f = fixture();
    const boot = createBoot(f.options);
    await boot.start();
    expect(f.fetch).toHaveBeenCalledWith(
      "/app/manifest.json",
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
        redirect: "error",
        credentials: "same-origin",
      }),
    );
    await boot.close();
  });
  it("normalizes network and malformed manifest failures to AppError", async () => {
    const f = fixture();
    f.fetch.mockRejectedValue(new TypeError("network"));
    const boot = createBoot(f.options);
    await expect(boot.start()).rejects.toBeInstanceOf(AppError);
    await boot.close();
  });
  it("preserves dependency-free shell integrity error codes", async () => {
    const f = fixture();
    vi.mocked(f.installer.install).mockRejectedValue({
      code: "E_INTEGRITY",
      message: "资源校验失败",
    });
    const boot = createBoot(f.options);
    await expect(boot.start()).rejects.toMatchObject({ code: "E_INTEGRITY" });
    await boot.close();
  });
  it("reports missing worker support after cached confirmation", async () => {
    const f = fixture();
    const boot = createBoot({
      ...f.options,
      environment: { ...f.options.environment, navigator: { onLine: true } },
    });
    await expect(boot.start()).rejects.toMatchObject({ code: "E_INVALID" });
    expect(f.installer.confirmBoot).toHaveBeenCalledTimes(1);
    await boot.close();
  });
});
