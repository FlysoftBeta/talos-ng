import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import { join, extname } from "node:path";
import { loadReleaseAssets } from "./release-assets.ts";
import { AppError } from "@talos/base";

export interface AssetEntry {
  path: string;
  size: number;
  sha256: string;
  mime: string;
}
export interface HttpAssets {
  manifest: { build: string; assets: AssetEntry[] };
  files: ReadonlyMap<string, { bytes: Uint8Array; mime: string }>;
}
const MIME: Readonly<Record<string, string>> = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
});
/** Assets are immutable boot snapshots, so served bytes always match the manifest. */
export async function loadHttpAssets(
  directory: string | undefined,
  build: string,
  workerFile?: string,
): Promise<HttpAssets> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(build))
    throw new AppError("E_INVALID", "无效的构建标识");
  const release = directory ? await loadReleaseAssets(directory) : undefined;
  if (release) {
    const files = new Map(release.files);
    if (workerFile) await addWorker(files, workerFile);
    return { ...release, files };
  }
  const files = new Map<string, { bytes: Uint8Array; mime: string }>();
  const assets: AssetEntry[] = [];
  if (directory) {
    const walk = async (relative: string): Promise<void> => {
      for (const entry of await readdir(join(directory, relative), {
        withFileTypes: true,
      })) {
        const rel = relative ? `${relative}/${entry.name}` : entry.name;
        // Do not serve symlinks, hidden files, or filenames with URL/path ambiguities.
        if (
          entry.name.startsWith(".") ||
          /[\\%?#:]/.test(entry.name) ||
          entry.isSymbolicLink()
        )
          continue;
        if (entry.isDirectory()) await walk(rel);
        else if (entry.isFile()) {
          const path = join(directory, ...rel.split("/"));
          if ((await lstat(path)).isSymbolicLink()) continue;
          const bytes = await readFile(path);
          const mime = MIME[extname(entry.name)] ?? "application/octet-stream";
          const url = `/app/${build}/${rel}`;
          files.set(url, { bytes, mime });
          if (rel === "index.html") files.set("/", { bytes, mime });
          if (rel === "sw.js") files.set("/sw.js", { bytes, mime });
          assets.push({
            path: url,
            size: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            mime,
          });
        }
      }
    };
    try {
      await walk("");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw AppError.wrap("E_UNAVAILABLE", "无法读取客户端资源目录", error);
    }
  }
  if (workerFile) await addWorker(files, workerFile);
  assets.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { manifest: { build, assets }, files };
}

async function addWorker(
  files: Map<string, { bytes: Uint8Array; mime: string }>,
  path: string,
): Promise<void> {
  try {
    files.set("/sw.js", { bytes: await readFile(path), mime: MIME[".js"]! });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw AppError.wrap("E_UNAVAILABLE", "无法读取离线启动程序", error);
  }
}
