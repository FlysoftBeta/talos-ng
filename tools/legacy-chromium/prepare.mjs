import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import extract from "extract-zip";

export const REVISION = "587811";
export const SNAPSHOT_URL = `https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/${REVISION}/chrome-linux.zip`;
// Official bucket object generation 1535668921668411; detects incomplete/corrupt downloads.
export const ARCHIVE_MD5 = "8e05eb3d6598904b7fb8a7758b758132";
export const CACHE = path.join(
  homedir(),
  ".cache",
  "talos-ng",
  "chromium",
  REVISION,
);

export function readVersion(executable) {
  const result = spawnSync(executable, ["--version"], { encoding: "utf8" });
  if (result.error || result.status !== 0)
    throw new Error(
      `Cannot run ${executable}: ${result.error?.message || result.stderr || `exit ${result.status}`}`,
    );
  return result.stdout.trim();
}

/** Downloads a pinned official Linux x64 snapshot. No package managers or shell tools. */
export async function prepareChrome70({
  cache = CACHE,
  fetch: fetcher = fetch,
} = {}) {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error(
      "Chromium 70 snapshot harness requires Linux x64; use pnpm e2e on Windows.",
    );
  const executable = path.join(cache, "chrome-linux", "chrome");
  try {
    const version = readVersion(executable);
    if (!/^Chromium 70\./.test(version))
      throw new Error(`Snapshot version mismatch: ${version}`);
    return { executable, version, revision: REVISION };
  } catch {
    /* Download once if missing or invalid. */
  }
  await mkdir(path.dirname(cache), { recursive: true });
  const temporary = await mkdtemp(`${cache}-download-`);
  try {
    const response = await fetcher(SNAPSHOT_URL);
    if (!response.ok)
      throw new Error(`Snapshot download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("md5").update(bytes).digest("hex") !== ARCHIVE_MD5)
      throw new Error("Snapshot archive checksum mismatch");
    const archive = path.join(temporary, "snapshot.zip");
    await writeFile(archive, bytes);
    await extract(archive, { dir: temporary });
    await rm(archive);
    const binary = path.join(temporary, "chrome-linux", "chrome");
    // ZIP extraction does not consistently preserve execute bits; Windows never uses this path.
    await chmod(binary, 0o755);
    const version = readVersion(binary);
    if (!/^Chromium 70\./.test(version))
      throw new Error(`Snapshot version mismatch: ${version}`);
    await writeFile(
      path.join(temporary, "snapshot.json"),
      JSON.stringify(
        { revision: REVISION, version, url: SNAPSHOT_URL, md5: ARCHIVE_MD5 },
        null,
        2,
      ),
    );
    await rm(cache, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 100,
    });
    await rename(temporary, cache);
    return { executable, version, revision: REVISION };
  } finally {
    await rm(temporary, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 100,
    });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  prepareChrome70()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
