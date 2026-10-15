import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  readdir,
  mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { digest, writeZip } from "./archive.ts";
import { buildId, verifyRelease } from "./manifest.ts";
import type { ReleaseManifest } from "./manifest.ts";
import { ReleaseFiles } from "./release-files.ts";
import { assertTarget, installedTarget, parseTarget } from "./target.ts";
import { acquireLock } from "../process/lock.ts";

const REQUIRED = [
  "server.js",
  "client/index.html",
  "shell/sw.js",
  "package.json",
];
function release(
  build: string,
  platform: ReleaseManifest["platform"],
  mutate: (
    m: Record<string, unknown>,
    f: Map<string, Buffer>,
  ) => void = () => {},
): Buffer {
  const files = new Map(REQUIRED.map((n) => [n, Buffer.from(`${n}:${build}`)]));
  const manifest: Record<string, unknown> = {
    v: 1,
    build,
    platform,
    files: [...files].map(([path, b]) => ({
      path,
      size: b.length,
      sha256: digest(b),
    })),
  };
  mutate(manifest, files);
  const all = new Map<string, Buffer>(files);
  all.set("release.json", Buffer.from(JSON.stringify(manifest)));
  return writeZip(all);
}

describe("release manifest verification", () => {
  it("accepts a build id only in the safe alphabet and length", () => {
    expect(buildId("A1_b-2")).toBe("A1_b-2");
    for (const bad of ["", "-x", "_x", "a/b", "a b", "a".repeat(81), "中"])
      expect(() => buildId(bad)).toThrow();
  });
  it.each([
    [
      "missing manifest",
      () => writeZip(new Map([["server.js", Buffer.from("x")]])),
    ],
    ["wrong version", () => release("b1", "win32-x64", (m) => void (m.v = 2))],
    [
      "unknown platform",
      () =>
        release("b1", "win32-x64", (m) => void (m.platform = "darwin-arm64")),
    ],
    [
      "bad build id",
      () => release("b1", "win32-x64", (m) => void (m.build = "../x")),
    ],
    [
      "listed size mismatch",
      () =>
        release("b1", "win32-x64", (m) => {
          (m.files as { size: number }[])[0]!.size += 1;
        }),
    ],
    [
      "listed hash mismatch",
      () =>
        release("b1", "win32-x64", (m) => {
          (m.files as { sha256: string }[])[0]!.sha256 = "0".repeat(64);
        }),
    ],
    [
      "duplicate manifest entry",
      () =>
        release("b1", "win32-x64", (m) => {
          const list = m.files as unknown[];
          list[1] = list[0];
        }),
    ],
    [
      "required entry missing",
      () =>
        release("b1", "win32-x64", (m, f) => {
          f.delete("shell/sw.js");
          m.files = (m.files as { path: string }[]).filter(
            (e) => e.path !== "shell/sw.js",
          );
        }),
    ],
    [
      "negative size",
      () =>
        release("b1", "win32-x64", (m) => {
          (m.files as { size: number }[])[0]!.size = -1;
        }),
    ],
  ])("rejects %s", (_name, make) => {
    expect(() => verifyRelease(make())).toThrow();
  });
  it("labels corruption as E_INTEGRITY and malformed shape as E_INVALID", () => {
    const wrongHash = release("b1", "win32-x64", (m) => {
      (m.files as { sha256: string }[])[0]!.sha256 = "0".repeat(64);
    });
    expect(() => verifyRelease(wrongHash)).toThrowError(
      expect.objectContaining({ code: "E_INTEGRITY" }),
    );
    expect(() =>
      verifyRelease(release("b1", "win32-x64", (m) => void (m.v = 9))),
    ).toThrowError(expect.objectContaining({ code: "E_INVALID" }));
  });
});

describe("package targets", () => {
  it("parses only the three deploy targets", () => {
    for (const t of ["win32-x64", "linux-debian-x64", "linux-redhat-x64"])
      expect(parseTarget(t)).toBe(t);
    expect(() => parseTarget("darwin-x64")).toThrow();
    expect(() => assertTarget("win32-x64", "linux-debian-x64")).toThrowError(
      expect.objectContaining({ code: "E_INVALID" }),
    );
    expect(() => assertTarget("win32-x64", "win32-x64")).not.toThrow();
  });
});

describe("release files and lock on disk", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "talos-release-"));
    await writeFile(join(root, "target"), "linux-debian-x64\n");
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("reads the install target from the target file", () => {
    expect(installedTarget(root)).toBe("linux-debian-x64");
  });

  it("stages a verified build once, refuses to overwrite and leaves no staging dir", async () => {
    const files = new ReleaseFiles(root);
    const zip = release("b2", "linux-debian-x64");
    expect(await files.stage(zip, digest(zip))).toBe("b2");
    expect(await readFile(join(root, "releases/b2/server.js"), "utf8")).toBe(
      "server.js:b2",
    );
    await expect(files.stage(zip, digest(zip))).rejects.toMatchObject({
      code: "E_CONFLICT",
    });
    expect(await readdir(join(root, "releases"))).toEqual(["b2"]);
  });

  it("refuses a build for another platform or a wrong outer hash without touching disk", async () => {
    const files = new ReleaseFiles(root);
    const win = release("b3", "win32-x64");
    await expect(files.stage(win, digest(win))).rejects.toMatchObject({
      code: "E_INVALID",
    });
    const ok = release("b3", "linux-debian-x64");
    await expect(files.stage(ok, "0".repeat(64))).rejects.toMatchObject({
      code: "E_INTEGRITY",
    });
    await expect(readdir(join(root, "releases"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("recovers from a stale staging directory left by a crash", async () => {
    await mkdir(join(root, "releases/b4.staging"), { recursive: true });
    await writeFile(join(root, "releases/b4.staging/junk"), "x");
    const files = new ReleaseFiles(root);
    const zip = release("b4", "linux-debian-x64");
    await files.stage(zip, digest(zip));
    expect((await readdir(join(root, "releases"))).sort()).toEqual(["b4"]);
    expect((await readdir(join(root, "releases/b4"))).includes("junk")).toBe(
      false,
    );
  });

  it("state is the commit record: read repairs the current pointer and validates pending", async () => {
    const files = new ReleaseFiles(root);
    const state = {
      current: "B",
      pending: { build: "C", previous: "B", deadline: 5, backup: "bk" },
    };
    await files.save(state);
    await writeFile(join(root, "current"), "stale\n");
    expect(await files.read()).toEqual(state);
    expect(await readFile(join(root, "current"), "utf8")).toBe("B\n");
    await writeFile(
      join(root, "launcher-state.json"),
      JSON.stringify({
        current: "B",
        pending: { build: "../C", previous: "B", deadline: 5 },
      }),
    );
    await expect(files.read()).rejects.toThrow();
    await writeFile(
      join(root, "launcher-state.json"),
      JSON.stringify({
        current: "B",
        pending: { build: "C", previous: "B", deadline: 1.5 },
      }),
    );
    await expect(files.read()).rejects.toThrow();
  });

  it("lock: reclaims a dead owner but never a live one or a corrupt file", async () => {
    const lock = join(root, "launcher.lock");
    await writeFile(lock, String(process.pid));
    await expect(acquireLock(root, true)).rejects.toMatchObject({
      code: "E_BUSY",
    });
    await writeFile(lock, "garbage");
    await expect(acquireLock(root, true)).rejects.toMatchObject({
      code: "E_BUSY",
    });
    // a pid that cannot exist (above the Linux/Windows pid ceiling)
    await writeFile(lock, "2147483646");
    const unlock = await acquireLock(root, true);
    expect(await readFile(lock, "utf8")).toBe(String(process.pid));
    await unlock();
    await expect(readFile(lock, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
