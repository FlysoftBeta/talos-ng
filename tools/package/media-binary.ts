import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { digest, readZip } from "@talos/launcher";

/** The pinned yt-dlp release: one manifest, one cache, shared by packaging and `pnpm dev`. */
export type MediaPlatform = "linux-x64" | "win32-x64";
export const mediaManifest = JSON.parse(
  await readFile(join(import.meta.dirname, "media-manifest.json"), "utf8"),
) as {
  version: string;
  linux: { url: string; sha256: string };
  windows: { url: string; sha256: string };
  plugin: { source: string; files: string[] };
};

function cacheDirectory(): string {
  return (
    process.env.TALOS_MEDIA_CACHE ??
    join(homedir(), ".cache", "talos-ng", "media")
  );
}

/** The verified downloaded asset (a Linux executable or the Windows zip), from cache or the network. */
export async function ytDlpAsset(platform: MediaPlatform): Promise<Buffer> {
  const spec =
    platform === "win32-x64" ? mediaManifest.windows : mediaManifest.linux;
  const dir = cacheDirectory();
  await mkdir(dir, { recursive: true });
  const path = join(
    dir,
    platform === "win32-x64"
      ? `yt-dlp-${mediaManifest.version}-win.zip`
      : `yt-dlp-${mediaManifest.version}-linux`,
  );
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    bytes = Buffer.alloc(0);
  }
  if (digest(bytes) !== spec.sha256) {
    const response = await fetch(spec.url);
    if (!response.ok)
      throw new Error(`yt-dlp download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== spec.sha256)
      throw new Error("yt-dlp SHA-256 mismatch");
    await writeFile(path, bytes);
  }
  return bytes;
}

/** The release layout of a platform's asset: paths under `vendor/media/`. */
export async function ytDlpFiles(
  platform: MediaPlatform,
): Promise<Map<string, Uint8Array>> {
  const bytes = await ytDlpAsset(platform);
  if (platform === "linux-x64")
    return new Map([["vendor/media/yt-dlp", bytes]]);
  const result = new Map<string, Uint8Array>();
  for (const [name, data] of readZip(bytes))
    if (name === "yt-dlp.exe" || name.startsWith("_internal/"))
      result.set(`vendor/media/${name}`, data);
  if (!result.has("vendor/media/yt-dlp.exe"))
    throw new Error("yt-dlp.exe missing");
  return result;
}

/**
 * The runnable pinned yt-dlp for this host, downloaded and verified on first
 * use; null where no pinned build exists (the caller runs without music).
 */
export async function installedYtDlp(): Promise<string | null> {
  const platform: MediaPlatform | null =
    process.arch !== "x64"
      ? null
      : process.platform === "linux"
        ? "linux-x64"
        : process.platform === "win32"
          ? "win32-x64"
          : null;
  if (!platform) return null;
  const dir = join(cacheDirectory(), `yt-dlp-${mediaManifest.version}`);
  const executable = join(
    dir,
    platform === "win32-x64" ? "yt-dlp.exe" : "yt-dlp",
  );
  const marker = join(dir, ".verified");
  const current = await stat(marker).then(
    () => true,
    () => false,
  );
  if (!current) {
    const files = await ytDlpFiles(platform);
    for (const [name, data] of files) {
      const target = join(dir, name.slice("vendor/media/".length));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    }
    if (platform === "linux-x64") await chmod(executable, 0o755);
    await writeFile(marker, mediaManifest.version);
  }
  return executable;
}
