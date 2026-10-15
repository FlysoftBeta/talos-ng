import { Blob as TestBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  createInstaller,
  install,
  status,
  apply,
  confirmBoot,
} from "./installer.ts";
import { ShellDatabase } from "./database.ts";
import { ShellError } from "./error.ts";
import { digest, validateManifest } from "./integrity.ts";
import { createShellRuntime } from "./runtime.ts";
import type {
  InstallProgress,
  InstallerState,
  ShellEnvironment,
  ShellManifest,
} from "./types.ts";

const crypto = webcrypto as unknown as Crypto;
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});
function setup() {
  const environment: ShellEnvironment = { indexedDB: new IDBFactory(), crypto };
  const database = new ShellDatabase(environment);
  const installer = createInstaller(environment);
  const fetch = vi.fn(async () => new Response("network"));
  const runtime = createShellRuntime({
    ...environment,
    origin: "http://localhost",
    fetch,
  });
  closers.push(
    () => database.close(),
    () => installer.close(),
    () => runtime.close(),
  );
  return { environment, database, installer, runtime, fetch };
}
async function fixture(build = "a", extra = false) {
  const contents = new Map<string, string>([
    ["/app/" + build + "/index.html", "<html>" + build + "</html>"],
  ]);
  if (extra) contents.set("/app/" + build + "/app.js", "window.started=true");
  const assets = await Promise.all(
    Array.from(contents, async ([path, body]) => {
      const bytes = new TextEncoder().encode(body).buffer;
      return {
        path,
        size: bytes.byteLength,
        sha256: await digest(bytes, crypto),
        mime: path.endsWith(".html") ? "text/html" : "text/javascript",
      };
    }),
  );
  const manifest: ShellManifest = { build, assets };
  const fetch = vi.fn(
    async (input: string | Request) =>
      new Response(contents.get(String(input)), {
        status: contents.has(String(input)) ? 200 : 404,
      }),
  );
  return { manifest, contents, fetch };
}
function navigation(path = "/"): Request {
  const request = new Request("http://localhost" + path);
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
}

describe("manifest and errors", () => {
  it("copies the manifest and requires the shell document", async () => {
    const { manifest } = await fixture();
    expect(validateManifest(manifest)).toEqual(manifest);
    expect(validateManifest(manifest)).not.toBe(manifest);
    expect(() => validateManifest({ ...manifest, assets: [] })).toThrow(
      ShellError,
    );
  });
  it.each(["../x", "", "x/y", "-x", "x".repeat(129)])(
    "rejects invalid build %s",
    async (build) => {
      const { manifest } = await fixture();
      expect(() => validateManifest({ ...manifest, build })).toThrow(
        ShellError,
      );
    },
  );
  it.each([
    "/app/a/../x",
    "/app/a//x",
    "/app/a/x?y",
    "/app/a/%2e/x",
    "/app/b/index.html",
    "https://evil.test/index.html",
  ])("rejects invalid path %s", async (path) => {
    const { manifest } = await fixture();
    expect(() =>
      validateManifest({
        ...manifest,
        assets: [{ ...manifest.assets[0]!, path }],
      }),
    ).toThrow(ShellError);
  });
  it.each([
    { size: -1 },
    { size: 0.5 },
    { size: Infinity },
    { sha256: "bad" },
    { mime: "text/html\r\nHeader: bad" },
  ])("rejects invalid descriptor %j", async (changes) => {
    const { manifest } = await fixture();
    expect(() =>
      validateManifest({
        ...manifest,
        assets: [{ ...manifest.assets[0]!, ...changes }],
      }),
    ).toThrow(ShellError);
  });
  it("rejects duplicates", async () => {
    const { manifest } = await fixture();
    expect(() =>
      validateManifest({
        ...manifest,
        assets: [...manifest.assets, ...manifest.assets],
      }),
    ).toThrow(ShellError);
  });
  it("exposes the AppError wire shape without a dependency", () => {
    expect(new ShellError("E_INTEGRITY", "错误").toJSON()).toEqual({
      code: "E_INTEGRITY",
      message: "错误",
    });
  });
});

describe("installer", () => {
  it("installs verified ArrayBuffers, publishes active atomically, and reports progress", async () => {
    const { installer, database } = setup();
    const { manifest, fetch } = await fixture("a", true);
    const progress: InstallProgress[] = [];
    await installer.install(manifest, {
      fetch,
      onProgress: (value) => progress.push(value),
    });
    expect(await installer.status()).toMatchObject({
      active: "a",
      pending: null,
      previous: null,
      bootAttempts: 0,
      builds: [{ complete: true }],
    });
    expect(installer.getState()).toEqual({ kind: "ready", build: "a" });
    expect(progress.map((value) => value.completed)).toEqual([0, 1, 2]);
    expect(fetch.mock.calls[0]?.[0]).toBe("/app/a/index.html");
    expect(
      (await database.getAsset("a", "/app/a/index.html"))?.bytes,
    ).toBeInstanceOf(ArrayBuffer);
  });
  it("uses no-store, same-origin credentials, and blocks redirects", async () => {
    const { installer } = setup();
    const { manifest, contents } = await fixture();
    const fetch = vi.fn(async (input: string | Request, init?: RequestInit) => {
      void init;
      return new Response(contents.get(String(input)));
    });
    await installer.install(manifest, { fetch });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    });
  });
  it("resumes after partial failure, rehashing and skipping existing assets", async () => {
    const { installer } = setup();
    const { manifest, fetch } = await fixture("a", true);
    await expect(
      installer.install(manifest, {
        fetch: async (input) =>
          String(input).endsWith(".js")
            ? new Response("", { status: 500 })
            : fetch(input),
      }),
    ).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
    expect(await installer.status()).toMatchObject({
      active: null,
      builds: [{ complete: false }],
    });
    fetch.mockClear();
    await installer.install(manifest, { fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/app/a/app.js", expect.any(Object));
  });
  it("rehashes and replaces corrupt resumed bytes even when metadata matches", async () => {
    const { installer, database } = setup();
    const { manifest, fetch } = await fixture();
    await installer.install(manifest, { fetch });
    const asset = manifest.assets[0]!;
    await database.putAsset("a", asset.path, {
      bytes: new Uint8Array(asset.size).buffer,
      mime: asset.mime,
      sha256: asset.sha256,
    });
    fetch.mockClear();
    await installer.install(manifest, { fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["wrong hash", "too short", "too long"])(
    "rejects corruption: %s",
    async (kind) => {
      const { installer } = setup();
      const { manifest } = await fixture();
      const body =
        kind === "wrong hash"
          ? "x".repeat(manifest.assets[0]!.size)
          : kind === "too short"
            ? "x"
            : "x".repeat(1000);
      await expect(
        installer.install(manifest, { fetch: async () => new Response(body) }),
      ).rejects.toMatchObject({ code: "E_INTEGRITY" });
      expect(await installer.status()).toMatchObject({
        active: null,
        pending: null,
        builds: [{ complete: false }],
      });
      expect(installer.getState()).toMatchObject({
        kind: "failed",
        error: { code: "E_INTEGRITY" },
      });
    },
  );
  it("rejects an immutable build id collision before downloading", async () => {
    const { installer } = setup();
    const { manifest, fetch } = await fixture();
    await installer.install(manifest, { fetch });
    fetch.mockClear();
    await expect(
      installer.install(
        {
          ...manifest,
          assets: manifest.assets.map((asset) => ({
            ...asset,
            sha256: "0".repeat(64),
          })),
        },
        { fetch },
      ),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not begin a cancelled installation", async () => {
    const { installer } = setup();
    const { manifest, fetch } = await fixture();
    const abort = new AbortController();
    abort.abort();
    await expect(
      installer.install(manifest, { fetch, signal: abort.signal }),
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("cancels after a download before publication", async () => {
    const { installer } = setup();
    const { manifest, fetch } = await fixture();
    const abort = new AbortController();
    await expect(
      installer.install(manifest, {
        fetch: async (input) => {
          const response = await fetch(input);
          abort.abort();
          return response;
        },
        signal: abort.signal,
      }),
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect((await installer.status()).active).toBeNull();
  });
  it("cancels while reading a streaming response", async () => {
    const { installer } = setup();
    const { manifest } = await fixture();
    const abort = new AbortController();
    await expect(
      installer.install(manifest, {
        fetch: async () =>
          new Response(
            new ReadableStream({
              pull() {
                abort.abort();
              },
            }),
          ),
        signal: abort.signal,
      }),
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
  });
  it("isolates observer errors", async () => {
    const { environment } = setup();
    const installer = createInstaller({
      ...environment,
      onState: () => {
        throw Error("UI");
      },
    });
    closers.push(() => installer.close());
    const { manifest, fetch } = await fixture();
    await installer.install(manifest, {
      fetch,
      onProgress: () => {
        throw Error("UI");
      },
    });
    expect(installer.getState().kind).toBe("ready");
  });
  it("rejects overlapping install calls", async () => {
    const { installer } = setup();
    const { manifest, fetch } = await fixture();
    const first = installer.install(manifest, { fetch });
    await expect(installer.install(manifest, { fetch })).rejects.toMatchObject({
      code: "E_BUSY",
    });
    await first;
  });
  it("enforces bounded asset size", async () => {
    const { environment } = setup();
    const installer = createInstaller({ ...environment, maxAssetBytes: 1 });
    const { manifest, fetch } = await fixture();
    await expect(installer.install(manifest, { fetch })).rejects.toMatchObject({
      code: "E_TOO_LARGE",
    });
    expect(fetch).not.toHaveBeenCalled();
    await installer.close();
    expect(() => createInstaller({ maxAssetBytes: -1 })).toThrow(ShellError);
  });
  it("normalizes fetch rejection", async () => {
    const { installer } = setup();
    const { manifest } = await fixture();
    await expect(
      installer.install(manifest, {
        fetch: async () => {
          throw new TypeError("offline");
        },
      }),
    ).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
  });
  it("supports stateless convenience calls and state transitions", async () => {
    const { environment, database } = setup();
    const a = await fixture("a");
    const b = await fixture("b");
    await install(a.manifest, { ...environment, fetch: a.fetch });
    await install(b.manifest, { ...environment, fetch: b.fetch });
    expect((await status(environment)).pending).toBe("b");
    await apply("b", environment);
    await database.navigate();
    await confirmBoot("b", environment);
    expect((await status(environment)).previous).toBeNull();
  });
  it("reports applying and failed state", async () => {
    const { environment } = setup();
    const states: InstallerState[] = [];
    const installer = createInstaller({
      ...environment,
      onState: (state) => states.push(state),
    });
    closers.push(() => installer.close());
    await expect(installer.apply()).rejects.toMatchObject({
      code: "E_NOT_FOUND",
    });
    const a = await fixture("a");
    const b = await fixture("b");
    await installer.install(a.manifest, { fetch: a.fetch });
    await installer.install(b.manifest, { fetch: b.fetch });
    await installer.apply();
    expect(states[0]?.kind).toBe("failed");
    expect(installer.getState()).toEqual({ kind: "applying" });
  });
});

describe("worker runtime and boot lifecycle", () => {
  it("passes unrelated traffic through without intercepting it", () => {
    const { runtime, fetch } = setup();
    [
      "/link",
      "/link/path",
      "/dl",
      "/dl/a",
      "/app/manifest.json",
      "/other",
    ].forEach((path) =>
      expect(
        runtime.handleFetch(new Request("http://localhost" + path)),
      ).toBeUndefined(),
    );
    expect(runtime.handleFetch(navigation("/link"))).toBeUndefined();
    expect(
      runtime.handleFetch(
        new Request("https://elsewhere.test/app/a/index.html"),
      ),
    ).toBeUndefined();
    expect(
      runtime.handleFetch(
        new Request("http://localhost/app/a/index.html", { method: "POST" }),
      ),
    ).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("falls back to the network for an uninstalled build and first navigation", async () => {
    const { runtime, fetch } = setup();
    expect(await (await runtime.handleFetch(navigation()))?.text()).toBe(
      "network",
    );
    expect(
      await (
        await runtime.handleFetch(new Request("http://localhost/app/no/app.js"))
      )?.text(),
    ).toBe("network");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("boots offline from IndexedDB without making any network request", async () => {
    const { installer, runtime, fetch } = setup();
    const a = await fixture("a", true);
    await installer.install(a.manifest, { fetch: a.fetch });
    fetch.mockImplementation(async () => {
      throw Error("offline");
    });
    expect(await (await runtime.handleFetch(navigation()))?.text()).toBe(
      "<html>a</html>",
    );
    const response = await runtime.handleFetch(
      new Request("http://localhost/app/a/app.js?cache=1"),
    );
    expect(await response?.text()).toBe("window.started=true");
    expect(response?.headers.get("content-type")).toBe("text/javascript");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not wait for network for corrupt or missing installed assets", async () => {
    const { installer, database, runtime, fetch } = setup();
    const a = await fixture();
    await installer.install(a.manifest, { fetch: a.fetch });
    const descriptor = a.manifest.assets[0]!;
    await database.putAsset("a", descriptor.path, {
      bytes: new Uint8Array(descriptor.size).buffer,
      sha256: descriptor.sha256,
      mime: descriptor.mime,
    });
    expect((await runtime.handleFetch(navigation()))?.status).toBe(503);
    expect(
      (
        await runtime.handleFetch(
          new Request("http://localhost/app/a/missing.js"),
        )
      )?.status,
    ).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps downloaded builds staged until confirmation, then rolls back failed boots", async () => {
    const { installer, runtime } = setup();
    const a = await fixture("a");
    const b = await fixture("b");
    await installer.install(a.manifest, { fetch: a.fetch });
    await installer.install(b.manifest, { fetch: b.fetch });
    expect(await installer.status()).toMatchObject({
      active: "a",
      pending: "b",
      previous: null,
    });
    expect(await (await runtime.handleFetch(navigation()))?.text()).toBe(
      "<html>a</html>",
    );
    expect((await installer.status()).pending).toBe("b");
    await installer.apply("b");
    expect(await (await runtime.handleFetch(navigation()))?.text()).toBe(
      "<html>b</html>",
    );
    expect(await installer.status()).toMatchObject({
      active: "b",
      pending: null,
      previous: "a",
      bootAttempts: 1,
    });
    expect(await (await runtime.handleFetch(navigation()))?.text()).toBe(
      "<html>b</html>",
    );
    expect(await installer.status()).toMatchObject({ bootAttempts: 2 });
    expect(await (await runtime.handleFetch(navigation()))?.text()).toBe(
      "<html>a</html>",
    );
    expect(await installer.status()).toMatchObject({
      active: "a",
      previous: null,
      bootAttempts: 0,
    });
  });
  it("confirms only the active build and prevents rollback once confirmed", async () => {
    const { installer, runtime } = setup();
    const a = await fixture("a");
    const b = await fixture("b");
    await installer.install(a.manifest, { fetch: a.fetch });
    await installer.install(b.manifest, { fetch: b.fetch });
    await installer.apply("b");
    await runtime.handleFetch(navigation());
    expect(
      await runtime.handleMessage({ type: "confirmBoot", build: "a" }),
    ).toMatchObject({ ok: false, error: { code: "E_CONFLICT" } });
    expect(
      await runtime.handleMessage({ type: "confirmBoot", build: "b" }),
    ).toEqual({ ok: true, value: null });
    for (let i = 0; i < 4; i++) await runtime.handleFetch(navigation());
    expect(await installer.status()).toMatchObject({
      active: "b",
      previous: null,
      bootAttempts: 0,
    });
  });
  it("prunes only builds not protected by active, pending or rollback", async () => {
    const { installer, runtime, database } = setup();
    for (const build of ["a", "b"]) {
      const f = await fixture(build);
      await installer.install(f.manifest, { fetch: f.fetch });
    }
    await installer.apply("b");
    await runtime.handleFetch(navigation());
    expect(await runtime.handleMessage({ type: "prune" })).toEqual({
      ok: true,
      value: [],
    });
    await installer.confirmBoot("b");
    expect(await runtime.handleMessage({ type: "prune" })).toEqual({
      ok: true,
      value: ["a"],
    });
    expect(await database.getAsset("a", "/app/a/index.html")).toBeUndefined();
    expect((await installer.status()).builds).toHaveLength(1);
  });
  it("handles the status and activation message API", async () => {
    const { installer, runtime } = setup();
    const a = await fixture();
    await installer.install(a.manifest, { fetch: a.fetch });
    expect(await runtime.handleMessage({ type: "status" })).toMatchObject({
      ok: true,
      value: { active: "a" },
    });
    expect(
      await runtime.handleMessage({ type: "activate", build: "missing" }),
    ).toMatchObject({ ok: false, error: { code: "E_NOT_FOUND" } });
    expect(
      await runtime.handleMessage({ type: "activate", build: "a" }),
    ).toEqual({ ok: true, value: null });
  });
  it.each([
    null,
    1,
    {},
    { type: "unknown" },
    { type: "activate", build: 12 },
    { type: "confirmBoot" },
  ])("rejects malformed message %j", async (message) => {
    expect(await setup().runtime.handleMessage(message)).toMatchObject({
      ok: false,
      error: { code: "E_INVALID" },
    });
  });
  it("serializes concurrent navigation transitions", async () => {
    const { installer, database } = setup();
    for (const build of ["a", "b"]) {
      const f = await fixture(build);
      await installer.install(f.manifest, { fetch: f.fetch });
    }
    await installer.apply("b");
    expect(
      await Promise.all([
        database.navigate(),
        database.navigate(),
        database.navigate(),
      ]),
    ).toEqual(["b", "b", "a"]);
  });
  it("never publishes an incomplete build after partial data was pruned", async () => {
    const { database } = setup();
    const { manifest } = await fixture();
    await database.beginBuild(manifest);
    await expect(database.completeBuild(manifest)).rejects.toMatchObject({
      code: "E_INTEGRITY",
    });
    expect((await database.status()).active).toBeNull();
    await database.prune();
    await expect(database.completeBuild(manifest)).rejects.toMatchObject({
      code: "E_CONFLICT",
    });
  });
});

describe("concurrent updates and cleanup", () => {
  it("retains the last confirmed rollback target through multiple unconfirmed updates", async () => {
    const { installer, database } = setup();
    for (const build of ["a", "b", "c"]) {
      const value = await fixture(build);
      await installer.install(value.manifest, { fetch: value.fetch });
      await installer.apply(build);
      await database.navigate();
    }
    expect(await installer.status()).toMatchObject({
      active: "c",
      previous: "a",
      bootAttempts: 1,
    });
    await database.navigate();
    expect(await database.navigate()).toBe("a");
  });
  it("does not leave orphan assets when prune races an ongoing download", async () => {
    const { database } = setup();
    const { manifest } = await fixture();
    await database.beginBuild(manifest);
    await database.prune();
    const asset = manifest.assets[0]!;
    await expect(
      database.putAsset("a", asset.path, {
        bytes: new ArrayBuffer(asset.size),
        mime: asset.mime,
        sha256: asset.sha256,
      }),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });
    expect(await database.getAsset("a", asset.path)).toBeUndefined();
  });
  it("maintains complete and distinct protected builds over deterministic random events", async () => {
    const { installer, database } = setup();
    let seed = 13;
    for (let i = 0; i < 120; i++) {
      seed = (seed * 16807) % 2147483647;
      const before = await installer.status();
      switch (seed % 5) {
        case 0: {
          const value = await fixture("b" + i);
          await installer.install(value.manifest, { fetch: value.fetch });
          break;
        }
        case 1:
          await database.navigate();
          break;
        case 2:
          if (before.active) await database.confirmBoot(before.active);
          break;
        case 3:
          await database.prune();
          break;
        case 4:
          if (before.pending) await installer.apply(before.pending);
          break;
      }
      const after = await installer.status();
      for (const build of [after.active, after.pending, after.previous]) {
        if (build)
          expect(
            after.builds.some(
              (record) => record.manifest.build === build && record.complete,
            ),
          ).toBe(true);
      }
      expect(after.pending === null || after.pending !== after.active).toBe(
        true,
      );
      expect(after.previous === null || after.previous !== after.active).toBe(
        true,
      );
      expect(after.bootAttempts).toBeLessThanOrEqual(2);
      expect(JSON.parse(JSON.stringify(after))).toEqual(after);
    }
  });
});

it("rejects nested Blob values on shell asset and manifest write paths", async () => {
  const { database } = setup();
  const { manifest } = await fixture();
  const bad = { ...manifest, extra: { blob: new TestBlob(["forbidden"]) } };
  await expect(database.beginBuild(bad)).rejects.toMatchObject({
    code: "E_INVALID",
  });
  await database.beginBuild(manifest);
  await expect(
    database.putAsset("a", "/app/a/index.html", {
      bytes: new ArrayBuffer(0),
      mime: "text/html",
      sha256: "0".repeat(64),
      extra: new TestBlob(["forbidden"]),
    } as Parameters<ShellDatabase["putAsset"]>[2]),
  ).rejects.toMatchObject({ code: "E_INVALID" });
  await expect(database.completeBuild(bad)).rejects.toBeDefined();
  expect(await database.getAsset("a", "/app/a/index.html")).toBeUndefined();
});

it("protects explicit activation from a newer background download and prune", async () => {
  const { installer, database } = setup();
  for (const build of ["a", "b", "c"]) {
    const value = await fixture(build);
    await installer.install(value.manifest, { fetch: value.fetch });
    if (build === "b") await installer.apply("b");
  }
  await database.prune();
  expect(await database.navigate()).toBe("b");
  expect(await installer.status()).toMatchObject({
    active: "b",
    pending: "c",
    previous: "a",
  });
});
