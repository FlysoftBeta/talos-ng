import { AppError } from "@talos/base";
import { digest, readZip, safePath } from "./archive.ts";
export interface ReleaseManifest {
  v: 1;
  build: string;
  platform: "linux-debian-x64" | "linux-redhat-x64" | "win32-x64";
  files: { path: string; size: number; sha256: string }[];
}
export function buildId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value))
    throw new AppError("E_INVALID", "版本号无效");
  return value;
}
export function verifyRelease(
  bytes: Uint8Array,
  sha256?: string,
): { manifest: ReleaseManifest; files: Map<string, Buffer> } {
  if (sha256 && digest(bytes) !== sha256)
    throw new AppError("E_INTEGRITY", "更新包校验失败");
  const files = readZip(bytes);
  let manifest: ReleaseManifest;
  try {
    manifest = JSON.parse(
      files.get("release.json")!.toString(),
    ) as ReleaseManifest;
  } catch (error) {
    throw AppError.wrap("E_INVALID", "缺少更新清单", error);
  }
  if (
    !manifest ||
    typeof manifest !== "object" ||
    typeof manifest.build !== "string"
  )
    throw new AppError("E_INVALID", "更新清单无效");
  buildId(manifest.build);
  if (
    manifest.v !== 1 ||
    !["linux-debian-x64", "linux-redhat-x64", "win32-x64"].includes(
      manifest.platform,
    ) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== files.size - 1
  )
    throw new AppError("E_INVALID", "更新清单无效");
  const seen = new Set<string>();
  for (const entry of manifest.files) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      typeof entry.sha256 !== "string"
    )
      throw new AppError("E_INVALID", "更新文件清单无效");
    safePath(entry.path);
    const data = files.get(entry.path);
    if (
      seen.has(entry.path) ||
      entry.path === "release.json" ||
      !data ||
      data.length !== entry.size ||
      digest(data) !== entry.sha256
    )
      throw new AppError("E_INTEGRITY", "更新文件校验失败");
    seen.add(entry.path);
  }
  for (const name of [
    "server.js",
    "client/index.html",
    "shell/sw.js",
    "package.json",
  ])
    if (!files.has(name)) throw new AppError("E_INVALID", `更新包缺少 ${name}`);
  return { manifest, files };
}
