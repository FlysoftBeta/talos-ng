import { ShellError } from "./error.ts";
import type { ShellAsset, ShellManifest } from "./types.ts";

export function validateManifest(input: ShellManifest): ShellManifest {
  if (
    !input ||
    typeof input.build !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(input.build) ||
    !Array.isArray(input.assets) ||
    input.assets.length === 0
  ) {
    throw new ShellError("E_INVALID", "版本清单无效");
  }
  const prefix = "/app/" + input.build + "/";
  const seen = new Set<string>();
  let total = 0;
  const assets: ShellAsset[] = input.assets.map((asset: ShellAsset) => {
    if (
      !asset ||
      typeof asset.path !== "string" ||
      !asset.path.startsWith(prefix) ||
      !/^[a-zA-Z0-9/_.-]+$/.test(asset.path) ||
      asset.path
        .split("/")
        .some(
          (part, index) =>
            index > 0 && (!part || part === "." || part === ".."),
        ) ||
      seen.has(asset.path) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 0 ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      typeof asset.mime !== "string" ||
      !asset.mime ||
      /[\r\n]/.test(asset.mime)
    ) {
      throw new ShellError("E_INVALID", "资源清单无效");
    }
    seen.add(asset.path);
    total += asset.size;
    if (!Number.isSafeInteger(total))
      throw new ShellError("E_TOO_LARGE", "版本体积过大");
    return {
      path: asset.path,
      size: asset.size,
      sha256: asset.sha256,
      mime: asset.mime,
    };
  });
  if (!seen.has(prefix + "index.html"))
    throw new ShellError("E_INVALID", "版本缺少启动页面");
  return { build: input.build, assets };
}
export async function digest(
  bytes: ArrayBuffer,
  crypto: Pick<Crypto, "subtle">,
): Promise<string> {
  const result = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (let i = 0; i < result.length; i++)
    hex += result[i]!.toString(16).padStart(2, "0");
  return hex;
}
export async function verify(
  bytes: ArrayBuffer,
  asset: ShellAsset,
  crypto: Pick<Crypto, "subtle">,
): Promise<boolean> {
  return (
    bytes.byteLength === asset.size &&
    (await digest(bytes, crypto)) === asset.sha256
  );
}
