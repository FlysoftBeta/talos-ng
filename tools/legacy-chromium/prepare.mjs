import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import extract from "extract-zip";

/**
 * Pinned official Linux x64 snapshots by major version. The MD5 (the bucket's own object
 * hash) detects incomplete or corrupt downloads.
 */
export const SNAPSHOTS = {
  // Chromium 70.0.3538.0, bucket object generation 1535668921668411: the oldest client.
  70: { revision: "587811", md5: "8e05eb3d6598904b7fb8a7758b758132" },
  // Chromium 80.0.3987.0, generation 1575587722227802: the first version sent to HTTPS (D-143).
  80: { revision: "722269", md5: "25b2725dbe71e3c27bf64aba6009486f" },
};
export const snapshotUrl = (revision) =>
  `https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/${revision}/chrome-linux.zip`;
const defaultCache = (revision) =>
  path.join(homedir(), ".cache", "talos-ng", "chromium", revision);

export function readVersion(executable) {
  const result = spawnSync(executable, ["--version"], { encoding: "utf8" });
  if (result.error || result.status !== 0)
    throw new Error(
      `Cannot run ${executable}: ${result.error?.message || result.stderr || `exit ${result.status}`}`,
    );
  return result.stdout.trim();
}

/** Downloads a pinned official Linux x64 snapshot. No package managers or shell tools. */
export async function prepareChromium(
  major = 70,
  { cache, fetch: fetcher = fetch } = {},
) {
  const snapshot = SNAPSHOTS[major];
  if (!snapshot) throw new Error(`No pinned Chromium ${major} snapshot`);
  const { revision, md5 } = snapshot;
  const url = snapshotUrl(revision);
  cache ??= defaultCache(revision);
  const expected = new RegExp(`^Chromium ${major}\\.`);
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error(
      `Chromium ${major} snapshot harness requires Linux x64; use pnpm e2e on Windows.`,
    );
  const executable = path.join(cache, "chrome-linux", "chrome");
  try {
    const version = readVersion(executable);
    if (!expected.test(version))
      throw new Error(`Snapshot version mismatch: ${version}`);
    return { executable, version, revision };
  } catch {
    /* Download once if missing or invalid. */
  }
  await mkdir(path.dirname(cache), { recursive: true });
  const temporary = await mkdtemp(`${cache}-download-`);
  try {
    const response = await fetcher(url);
    if (!response.ok)
      throw new Error(`Snapshot download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("md5").update(bytes).digest("hex") !== md5)
      throw new Error("Snapshot archive checksum mismatch");
    const archive = path.join(temporary, "snapshot.zip");
    await writeFile(archive, bytes);
    await extract(archive, { dir: temporary });
    await rm(archive);
    const binary = path.join(temporary, "chrome-linux", "chrome");
    // ZIP extraction does not consistently preserve execute bits; Windows never uses this path.
    await chmod(binary, 0o755);
    const version = readVersion(binary);
    if (!expected.test(version))
      throw new Error(`Snapshot version mismatch: ${version}`);
    await writeFile(
      path.join(temporary, "snapshot.json"),
      JSON.stringify({ revision, version, url, md5 }, null, 2),
    );
    await rm(cache, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 100,
    });
    await rename(temporary, cache);
    return { executable, version, revision };
  } finally {
    await rm(temporary, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 100,
    });
  }
}

export const prepareChrome70 = (options) => prepareChromium(70, options);

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  prepareChromium(Number(process.argv[2] ?? 70))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
