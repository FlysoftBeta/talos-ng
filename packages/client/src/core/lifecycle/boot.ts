import type {
  Installer,
  InstallerState,
  ShellFetch,
  ShellManifest,
} from "@talos/shell";
import { AppError, ERROR_CODES } from "@talos/base";
import type { ErrorCode } from "@talos/base";

export interface BootHandle {
  readonly installer: Installer;
  /** Call after the application's first successful render, never before mounting it. */
  start(): Promise<void>;
  /** Aborts background work and closes the owned connection; safe to call repeatedly. */
  close(): Promise<void>;
}
export interface BootEnvironment {
  readonly navigator: {
    readonly onLine: boolean;
    readonly serviceWorker?: {
      register(
        scriptURL: string,
        options?: RegistrationOptions,
      ): Promise<unknown>;
      readonly ready: Promise<unknown>;
    };
  };
  readonly fetch: ShellFetch;
  readonly installer?: Installer;
  readonly createInstaller?: (
    onState: (state: InstallerState) => void,
  ) => Installer;
}
export interface BootOptions {
  readonly build: string;
  readonly onState?: (state: InstallerState) => void;
  readonly environment: BootEnvironment;
}

function cancelled(): AppError {
  return new AppError("E_CANCELLED", "启动任务已取消");
}
function bootError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  // Shell is deliberately dependency-free; preserve its structural AppError code.
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    (ERROR_CODES as readonly string[]).includes(error.code) &&
    typeof error.message === "string"
  ) {
    return new AppError(error.code as ErrorCode, error.message);
  }
  return new AppError("E_OFFLINE", "暂时无法检查更新");
}

/** Rendering never waits on this background task. Cached boot confirmation is network-free. */
export function createBoot({
  build,
  onState,
  environment,
}: BootOptions): BootHandle {
  const browser = environment.navigator;
  const fetchRequest: ShellFetch = environment.fetch;
  const abort = new AbortController();
  const isOffline = (): boolean => browser.onLine === false;
  let closed = false;
  let started: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const publish = (state: InstallerState): void => {
    if (!closed) {
      try {
        onState?.(state);
      } catch {
        /* A rendering observer must not interrupt installation. */
      }
    }
  };
  const installer =
    environment.installer ?? environment.createInstaller!(publish);
  const assertOpen = (): void => {
    if (closed) throw cancelled();
  };
  // SW registration/ready cannot be cancelled natively and may never finish offline.
  // Stop observing them promptly on disposal; late settlement cannot restart our work.
  const interruptible = <T>(operation: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const onAbort = (): void => {
        cleanup();
        reject(cancelled());
      };
      const cleanup = (): void =>
        abort.signal.removeEventListener("abort", onAbort);
      operation.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        },
      );
      if (closed) {
        reject(cancelled());
        return;
      }
      abort.signal.addEventListener("abort", onAbort);
    });
  async function run(): Promise<void> {
    assertOpen();
    const before = await installer.status();
    assertOpen();
    if (before.active === build) {
      await installer.confirmBoot(build);
      assertOpen();
      publish({ kind: "ready", build });
    }
    // navigator.onLine is only a negative hint: true never guarantees the server is reachable.
    if (isOffline()) {
      if (before.active !== build)
        throw new AppError("E_OFFLINE", "离线内容尚未保存");
      return;
    }
    if (!browser.serviceWorker)
      throw new AppError("E_INVALID", "此浏览器无法保存离线应用");
    await interruptible(
      browser.serviceWorker.register("/sw.js", { scope: "/" }),
    );
    assertOpen();
    await interruptible(browser.serviceWorker.ready);
    assertOpen();
    if (isOffline()) return;
    const response = await interruptible(
      fetchRequest("/app/manifest.json", {
        cache: "no-store",
        signal: abort.signal,
        credentials: "same-origin",
        redirect: "error",
      }),
    );
    assertOpen();
    if (!response.ok) throw new AppError("E_OFFLINE", "暂时无法检查更新");
    const manifest: ShellManifest = await interruptible(
      response.json() as Promise<ShellManifest>,
    );
    assertOpen();
    // Shell validates every field and verifies every asset; no contract/server dependency.
    await installer.install(manifest, {
      fetch: fetchRequest,
      signal: abort.signal,
    });
    assertOpen();
    const after = await installer.status();
    assertOpen();
    if (after.active === build) await installer.confirmBoot(build);
  }
  return {
    installer,
    start(): Promise<void> {
      if (closed) return Promise.reject(cancelled());
      if (!started)
        started = run().catch((error: unknown) => {
          throw closed ? cancelled() : bootError(error);
        });
      return started;
    },
    close(): Promise<void> {
      if (closing) return closing;
      closed = true;
      abort.abort();
      closing = (async () => {
        await started?.catch(() => undefined);
        await installer.close();
      })();
      return closing;
    },
  };
}
