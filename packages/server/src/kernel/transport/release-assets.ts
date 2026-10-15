import { readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { AppError, sha256Hex } from "@talos/base";
import type { HttpAssets } from "./http-assets.ts";

const manifestSchema = z
  .object({
    build: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    assets: z.array(
      z
        .object({
          path: z.string(),
          size: z.number().int().nonnegative(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          mime: z.string().regex(/^[\x20-\x7e]+$/),
        })
        .strict(),
    ),
  })
  .strict();

/** Load only manifest-listed release bytes; never expose build tooling or gallery files. */
export async function loadReleaseAssets(
  directory: string,
): Promise<HttpAssets | undefined> {
  let text: string;
  try {
    text = await readFile(join(directory, "app", "manifest.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new AppError("E_UNAVAILABLE", "无法读取客户端资源清单");
  }
  try {
    const manifest = manifestSchema.parse(JSON.parse(text) as unknown);
    const files = new Map<string, { bytes: Uint8Array; mime: string }>();
    for (const asset of manifest.assets) {
      const prefix = `/app/${manifest.build}/`;
      const parts = asset.path.slice(1).split("/");
      if (
        !asset.path.startsWith(prefix) ||
        parts.some((part) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)) ||
        files.has(asset.path)
      )
        throw new Error("Invalid asset path");
      // Reject symlinked ancestors as well as symlinked files.
      for (let n = 1; n <= parts.length; n++)
        if (
          (await lstat(join(directory, ...parts.slice(0, n)))).isSymbolicLink()
        )
          throw new Error("Symlink asset");
      const bytes = await readFile(join(directory, ...parts));
      if (bytes.length !== asset.size || sha256Hex(bytes) !== asset.sha256)
        throw new AppError("E_INTEGRITY", "客户端资源校验失败");
      files.set(asset.path, { bytes, mime: asset.mime });
    }
    const shell = files.get(`/app/${manifest.build}/index.html`);
    if (!shell) throw new Error("Missing shell");
    files.set("/", shell);
    return { manifest, files };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("E_INVALID", "客户端资源清单无效");
  }
}
