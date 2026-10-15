// Update state machine (task 150 (b)): manifest validation matrix, integrity failures that
// must leave the machine retryable, the apply/confirm hand-off to the launcher, the
// automatic-check throttle and the HTTPS-only network fetch. Pure unit level with injected
// fetch/backups/bridge; the API wiring is covered in api.test.ts and ops.test.ts.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { digest, hostTarget, writeZip } from "@talos/launcher";
import type { OpsSettings } from "../repo.ts";
import { Updates, fetchBytes } from "./service.ts";
import type { FetchBytes, UpdateBridge } from "./service.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

function release(build: string): Uint8Array {
  const files = new Map(
    ["server.js", "client/index.html", "shell/sw.js", "package.json"].map(
      (n) => [n, Buffer.from(n)],
    ),
  );
  files.set(
    "release.json",
    Buffer.from(
      JSON.stringify({
        v: 1,
        build,
        platform: hostTarget(),
        files: [...files].map(([path, b]) => ({
          path,
          size: b.length,
          sha256: digest(b),
        })),
      }),
    ),
  );
  return writeZip(files);
}

async function fixture(
  options: {
    settings?: Partial<OpsSettings>;
    fetch?: FetchBytes;
    bridge?: UpdateBridge | null;
    now?: () => number;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "talos-updates-"));
  dirs.push(directory);
  const settings: OpsSettings = {
    retention: 3,
    daily: false,
    cloudEnabled: true,
    autoCheck: true,
    manifestUrl: "https://example.org/update/manifest.json",
    ...options.settings,
  };
  const applied: unknown[] = [];
  const bridge: UpdateBridge | undefined =
    options.bridge === null
      ? undefined
      : (options.bridge ?? {
          apply: (message) => void applied.push(message),
          confirm: () => {},
          pending: false,
        });
  const backups = {
    create: vi.fn(async () => ({ id: "BACKUP", created: 1, size: 1 })),
    download: vi.fn(async function* () {
      yield Buffer.from("rollback bytes");
    }),
  };
  const fetch = options.fetch ?? (async () => Buffer.alloc(0));
  const updates = new Updates(
    { settings: () => settings },
    backups as never,
    directory,
    "A",
    options.now ?? Date.now,
    bridge,
    fetch,
  );
  return { updates, directory, backups, applied, settings };
}

const manifestBytes = (
  patch: Record<string, unknown> = {},
  bytes = release("B"),
) =>
  Buffer.from(
    JSON.stringify({
      v: 1,
      build: "B",
      url: "B.zip",
      size: bytes.length,
      sha256: digest(bytes),
      ...patch,
    }),
  );
const cloud =
  (
    bytes: Uint8Array,
    manifest: Buffer = manifestBytes({}, bytes),
  ): FetchBytes =>
  async (url) =>
    url.endsWith("manifest.json") ? manifest : bytes;

describe("update manifest and check", () => {
  it("rejects checks when the cloud is off or the launcher is missing, without changing phase", async () => {
    const off = await fixture({ settings: { cloudEnabled: false } });
    await expect(off.updates.check()).rejects.toMatchObject({
      code: "E_UNAVAILABLE",
    });
    expect(off.updates.status().phase).toBe("idle");
    const noUrl = await fixture({ settings: { manifestUrl: "" } });
    await expect(noUrl.updates.check()).rejects.toMatchObject({
      code: "E_UNAVAILABLE",
    });
    const bare = await fixture({ bridge: null });
    expect(bare.updates.status().launcher).toBe(false);
    await expect(bare.updates.check()).rejects.toMatchObject({
      code: "E_UNAVAILABLE",
    });
    await expect(bare.updates.stage(release("B"))).rejects.toMatchObject({
      code: "E_UNAVAILABLE",
    });
  });

  it.each([
    ["not json", Buffer.from("{")],
    ["wrong version", manifestBytes({ v: 2 })],
    ["missing build", manifestBytes({ build: 7 })],
    ["zero size", manifestBytes({ size: 0 })],
    ["fractional size", manifestBytes({ size: 1.5 })],
    ["oversized archive", manifestBytes({ size: 2 ** 40 })],
    ["short digest", manifestBytes({ sha256: "ab" })],
    ["uppercase digest", manifestBytes({ sha256: "A".repeat(64) })],
    ["plain-http download", manifestBytes({ url: "http://example.org/B.zip" })],
    ["null manifest", Buffer.from("null")],
  ])("refuses a %s manifest and stays retryable", async (_name, body) => {
    const f = await fixture({ fetch: async () => body });
    await expect(f.updates.check()).rejects.toMatchObject({
      code: "E_INVALID",
    });
    expect(f.updates.status()).toMatchObject({
      phase: "idle",
      candidate: null,
      progress: 0,
    });
    expect(f.updates.status().lastError).toBeTruthy();
    // Not stuck in "checking": the next check is allowed to run.
    await expect(f.updates.check()).rejects.toMatchObject({
      code: "E_INVALID",
    });
  });

  it("records a failed check as the last error and clears it after a good one", async () => {
    let bad = true;
    const bytes = release("B");
    const f = await fixture({
      fetch: async () => {
        if (bad) throw new Error("network down");
        return manifestBytes({}, bytes);
      },
    });
    await expect(f.updates.check()).rejects.toThrow();
    expect(f.updates.status().lastError).toBe("更新清单无效");
    bad = false;
    const status = await f.updates.check();
    expect(status).toMatchObject({
      phase: "idle",
      candidate: "B",
      lastError: null,
    });
  });
});

describe("staging and cloud install integrity", () => {
  it("stages a verified release durably with a rollback backup and refuses the installed build", async () => {
    const f = await fixture();
    const status = await f.updates.stage(release("B"));
    expect(status).toMatchObject({
      phase: "staged",
      candidate: "B",
      progress: 1,
    });
    const staged = JSON.parse(
      await readFile(join(f.directory, "staged-update.json"), "utf8"),
    ) as { archive: string; backup: string };
    expect((await readFile(staged.backup)).toString()).toBe("rollback bytes");
    const again = await fixture();
    await expect(again.updates.stage(release("A"))).rejects.toMatchObject({
      code: "E_CONFLICT",
    });
    expect(again.updates.status().phase).toBe("idle");
    expect(again.backups.create).not.toHaveBeenCalled();
  });

  it("rejects corrupt or tampered archives before any backup is taken", async () => {
    const f = await fixture();
    await expect(f.updates.stage(Buffer.from("not a zip"))).rejects.toThrow();
    expect(f.updates.status()).toMatchObject({
      phase: "idle",
      candidate: null,
    });
    expect(f.backups.create).not.toHaveBeenCalled();
  });

  it("detects length, digest and build mismatches during cloud install and recovers", async () => {
    const bytes = release("B");
    const short = await fixture({
      fetch: cloud(
        bytes.subarray(0, bytes.length - 1),
        manifestBytes({}, bytes),
      ),
    });
    await expect(short.updates.install()).rejects.toMatchObject({
      code: "E_INTEGRITY",
    });
    expect(short.updates.status().phase).toBe("idle");
    const flipped = Buffer.from(bytes);
    flipped.writeUInt8(
      ~flipped.readUInt8(flipped.length - 30) & 0xff,
      flipped.length - 30,
    );
    const digestMismatch = await fixture({
      fetch: cloud(flipped, manifestBytes({}, bytes)),
    });
    await expect(digestMismatch.updates.install()).rejects.toThrow();
    expect(digestMismatch.updates.status().phase).toBe("idle");
    expect(digestMismatch.backups.create).not.toHaveBeenCalled();
    const wrongBuild = await fixture({
      fetch: cloud(bytes, manifestBytes({ build: "C" }, bytes)),
    });
    await expect(wrongBuild.updates.install()).rejects.toMatchObject({
      code: "E_INTEGRITY",
    });
    const seen: string[] = [];
    const inner = cloud(bytes);
    const ok = await fixture({
      fetch: async (url, limit) => {
        seen.push(url);
        return inner(url, limit);
      },
    });
    expect((await ok.updates.install()).phase).toBe("staged");
    // A relative download URL is resolved against the manifest URL.
    expect(seen).toEqual([
      "https://example.org/update/manifest.json",
      "https://example.org/update/B.zip",
    ]);
  });
});

describe("apply / confirm hand-off", () => {
  it("applies only a staged update, once, and blocks other operations while pending", async () => {
    const f = await fixture();
    expect(() => f.updates.apply()).toThrow(
      expect.objectContaining({ code: "E_CONFLICT" }),
    );
    await f.updates.stage(release("B"));
    const run = f.updates.apply();
    expect(f.updates.status().phase).toBe("pending");
    expect(f.applied).toHaveLength(0); // deferred until after the RPC reply
    run();
    expect(f.applied).toHaveLength(1);
    expect(f.applied[0]).toMatchObject({
      backup: expect.stringContaining("rollback"),
    });
    expect(() => f.updates.apply()).toThrow(
      expect.objectContaining({ code: "E_CONFLICT" }),
    );
    await expect(f.updates.stage(release("C"))).rejects.toMatchObject({
      code: "E_BUSY",
    });
    await expect(f.updates.check()).rejects.toMatchObject({ code: "E_BUSY" });
  });

  it("starts pending when the launcher reports an unconfirmed update and confirm returns to idle", async () => {
    const confirm = vi.fn();
    const f = await fixture({
      bridge: { apply: () => {}, confirm, pending: true },
    });
    expect(f.updates.status().phase).toBe("pending");
    f.updates.confirm();
    expect(confirm).toHaveBeenCalledOnce();
    expect(f.updates.status().phase).toBe("idle");
    const bare = await fixture({ bridge: null });
    expect(() => bare.updates.confirm()).toThrow(
      expect.objectContaining({ code: "E_UNAVAILABLE" }),
    );
  });
});

describe("automatic check throttle", () => {
  it("checks at most every 15 minutes and only when enabled and idle", async () => {
    let now = 10_000_000;
    const fetch = vi.fn(async () => manifestBytes());
    const f = await fixture({ fetch, now: () => now });
    await f.updates.autoCheck();
    await f.updates.autoCheck();
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 899_999;
    await f.updates.autoCheck();
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 1;
    await f.updates.autoCheck();
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const settings of [{ autoCheck: false }, { cloudEnabled: false }]) {
      const calls = vi.fn(async () => manifestBytes());
      const off = await fixture({ settings, fetch: calls, now: () => now });
      await off.updates.autoCheck();
      expect(calls).not.toHaveBeenCalled();
    }
  });
});

describe("fetchBytes", () => {
  it("refuses non-HTTPS URLs and maps connection failures to unavailable", async () => {
    await expect(fetchBytes("http://example.org/x", 10)).rejects.toMatchObject({
      code: "E_INVALID",
    });
    await expect(fetchBytes("https://127.0.0.1:1/x", 10)).rejects.toMatchObject(
      {
        code: "E_UNAVAILABLE",
      },
    );
  });
});
