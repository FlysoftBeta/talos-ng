import { ShellDatabase } from "./database.ts";
import { ShellError, shellError, checkCancelled } from "./error.ts";
import { validateManifest, verify } from "./integrity.ts";
import type {
  InstallProgress,
  InstallerState,
  ShellEnvironment,
  ShellFetch,
  ShellManifest,
  ShellStatus,
} from "./types.ts";

export interface InstallerOptions extends ShellEnvironment {
  readonly fetch?: ShellFetch;
  readonly onState?: (state: InstallerState) => void;
  readonly maxAssetBytes?: number;
}
export interface InstallOptions {
  readonly fetch?: ShellFetch;
  readonly onProgress?: (progress: InstallProgress) => void;
  readonly signal?: AbortSignal;
}
export interface Installer {
  install(manifest: ShellManifest, options?: InstallOptions): Promise<void>;
  status(): Promise<ShellStatus>;
  apply(build?: string): Promise<void>;
  confirmBoot(build: string): Promise<void>;
  getState(): InstallerState;
  close(): Promise<void>;
}
async function readBytes(
  response: Response,
  expected: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    checkCancelled(signal);
    if (bytes.byteLength !== expected)
      throw new ShellError("E_INTEGRITY", "资源体积校验失败");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort);
  try {
    while (true) {
      checkCancelled(signal);
      const chunk = await reader.read();
      checkCancelled(signal);
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > expected)
        throw new ShellError("E_INTEGRITY", "资源体积校验失败");
      chunks.push(chunk.value);
    }
    if (length !== expected)
      throw new ShellError("E_INTEGRITY", "资源体积校验失败");
    const bytes = new Uint8Array(length);
    let offset = 0;
    chunks.forEach((chunk) => {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    });
    return bytes.buffer;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

export function createInstaller(options: InstallerOptions = {}): Installer {
  const database = new ShellDatabase(options);
  const maxAssetBytes = options.maxAssetBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0)
    throw new ShellError("E_INVALID", "资源大小上限无效");
  let state: InstallerState = { kind: "none" };
  let busy = false;
  function setState(next: InstallerState): void {
    state = next;
    try {
      options.onState?.(next);
    } catch {
      /* Rendering must not interrupt durable writes. */
    }
  }
  return {
    getState: () => state,
    status: () => database.status(),
    close: () => database.close(),
    confirmBoot: (build) => database.confirmBoot(build),
    async apply(build): Promise<void> {
      try {
        await database.activate(build);
        setState({ kind: "applying" });
      } catch (error) {
        const failure = shellError(error);
        setState({ kind: "failed", error: failure });
        throw failure;
      }
    },
    async install(input, installOptions = {}): Promise<void> {
      if (busy) throw new ShellError("E_BUSY", "已有版本正在下载");
      busy = true;
      try {
        checkCancelled(installOptions.signal);
        const manifest = validateManifest(input);
        if (manifest.assets.some((asset) => asset.size > maxAssetBytes))
          throw new ShellError("E_TOO_LARGE", "单个资源超过大小上限");
        const subtle = options.crypto ?? crypto;
        const fetchAsset: ShellFetch =
          installOptions.fetch ??
          options.fetch ??
          ((input, init) => fetch(input, init));
        let progress: InstallProgress = {
          completed: 0,
          total: manifest.assets.length,
          bytes: 0,
          totalBytes: manifest.assets.reduce(
            (total, asset) => total + asset.size,
            0,
          ),
        };
        const report = (): void => {
          setState({ kind: "installing", progress });
          try {
            installOptions.onProgress?.(progress);
          } catch {
            /* Observer errors are isolated. */
          }
        };
        report();
        await database.beginBuild(manifest);
        for (const asset of manifest.assets) {
          checkCancelled(installOptions.signal);
          const existing = await database.getAsset(manifest.build, asset.path);
          const valid =
            existing &&
            existing.mime === asset.mime &&
            existing.sha256 === asset.sha256 &&
            (await verify(existing.bytes, asset, subtle));
          if (!valid) {
            const response = await fetchAsset(asset.path, {
              cache: "no-store",
              signal: installOptions.signal,
              credentials: "same-origin",
              redirect: "error",
            });
            checkCancelled(installOptions.signal);
            if (!response.ok)
              throw new ShellError(
                "E_UNAVAILABLE",
                "资源下载失败：" + response.status,
              );
            const bytes = await readBytes(
              response,
              asset.size,
              installOptions.signal,
            );
            if (!(await verify(bytes, asset, subtle)))
              throw new ShellError(
                "E_INTEGRITY",
                "资源校验失败：" + asset.path,
              );
            checkCancelled(installOptions.signal);
            await database.putAsset(manifest.build, asset.path, {
              bytes,
              mime: asset.mime,
              sha256: asset.sha256,
            });
          }
          progress = {
            ...progress,
            completed: progress.completed + 1,
            bytes: progress.bytes + asset.size,
          };
          report();
        }
        checkCancelled(installOptions.signal);
        await database.completeBuild(manifest);
        setState({ kind: "ready", build: manifest.build });
      } catch (error) {
        const failure = installOptions.signal?.aborted
          ? new ShellError("E_CANCELLED", "下载已取消")
          : shellError(error);
        setState({ kind: "failed", error: failure });
        throw failure;
      } finally {
        busy = false;
      }
    },
  };
}

/** Convenience calls own and close their connection; createInstaller also exposes UI state. */
export async function install(
  manifest: ShellManifest,
  options: InstallOptions & InstallerOptions = {},
): Promise<void> {
  const installer = createInstaller(options);
  try {
    await installer.install(manifest, options);
  } finally {
    await installer.close();
  }
}
export async function status(
  options: ShellEnvironment = {},
): Promise<ShellStatus> {
  const database = new ShellDatabase(options);
  try {
    return await database.status();
  } finally {
    await database.close();
  }
}
export async function apply(
  build?: string,
  options: ShellEnvironment = {},
): Promise<void> {
  const database = new ShellDatabase(options);
  try {
    await database.activate(build);
  } finally {
    await database.close();
  }
}
export async function confirmBoot(
  build: string,
  options: ShellEnvironment = {},
): Promise<void> {
  const database = new ShellDatabase(options);
  try {
    await database.confirmBoot(build);
  } finally {
    await database.close();
  }
}
