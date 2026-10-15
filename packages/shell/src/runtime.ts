import { ShellDatabase } from "./database.ts";
import { ShellError, shellError } from "./error.ts";
import { verify } from "./integrity.ts";
import type { ShellEnvironment, ShellFetch, ShellStatus } from "./types.ts";

export interface RuntimeOptions extends ShellEnvironment {
  readonly origin: string;
  readonly fetch?: ShellFetch;
}
export type ShellMessage =
  | { readonly type: "status" }
  | { readonly type: "confirmBoot"; readonly build: string }
  | { readonly type: "activate"; readonly build?: string }
  | { readonly type: "prune" };
export type ShellMessageResult =
  | {
      readonly ok: true;
      readonly value: ShellStatus | readonly string[] | null;
    }
  | { readonly ok: false; readonly error: ReturnType<ShellError["toJSON"]> };
export interface ShellRuntime {
  /** Undefined means the worker must not call respondWith for this request. */
  handleFetch(request: Request): Promise<Response> | undefined;
  handleMessage(message: unknown): Promise<ShellMessageResult>;
  close(): Promise<void>;
}

export function createShellRuntime(options: RuntimeOptions): ShellRuntime {
  const database = new ShellDatabase(options);
  const network: ShellFetch =
    options.fetch ?? ((input, init) => fetch(input, init));
  async function serve(
    request: Request,
    path: string,
    navigation: boolean,
  ): Promise<Response> {
    const build = navigation
      ? await database.navigate()
      : (path.split("/")[2] ?? null);
    if (!build) return network(request);
    const state = await database.status();
    const record = state.builds.find(
      (candidate) => candidate.manifest.build === build && candidate.complete,
    );
    if (!record) return network(request);
    const assetPath = navigation ? "/app/" + build + "/index.html" : path;
    const descriptor = record.manifest.assets.find(
      (asset) => asset.path === assetPath,
    );
    const asset = descriptor
      ? await database.getAsset(build, assetPath)
      : undefined;
    // An installed build never waits for the network, even if damaged or incomplete on disk.
    if (
      !descriptor ||
      !asset ||
      asset.mime !== descriptor.mime ||
      asset.sha256 !== descriptor.sha256 ||
      !(await verify(asset.bytes, descriptor, options.crypto ?? crypto))
    ) {
      return new Response("应用资源校验失败，请重新启动以恢复上一版本。", {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
    return new Response(asset.bytes, {
      headers: {
        "Content-Type": asset.mime,
        "Content-Length": String(asset.bytes.byteLength),
        "Cache-Control": "no-store",
        "X-Talos-Build": build,
      },
    });
  }
  return {
    close: () => database.close(),
    handleFetch(request): Promise<Response> | undefined {
      const url = new URL(request.url);
      if (
        url.origin !== options.origin ||
        request.method !== "GET" ||
        url.pathname === "/link" ||
        url.pathname.startsWith("/link/") ||
        url.pathname === "/dl" ||
        url.pathname.startsWith("/dl/") ||
        url.pathname === "/app/manifest.json"
      )
        return undefined;
      const navigation = request.mode === "navigate";
      if (!navigation && !/^\/app\/[^/]+\/.+/.test(url.pathname))
        return undefined;
      return serve(request, url.pathname, navigation).catch(
        () =>
          new Response("应用暂时无法启动，请重试。", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
      );
    },
    async handleMessage(input): Promise<ShellMessageResult> {
      try {
        if (!input || typeof input !== "object" || !("type" in input))
          throw new ShellError("E_INVALID", "消息无效");
        const message = input as { type: unknown; build?: unknown };
        switch (message.type) {
          case "status":
            return { ok: true, value: await database.status() };
          case "confirmBoot":
            if (typeof message.build !== "string")
              throw new ShellError("E_INVALID", "版本标识无效");
            await database.confirmBoot(message.build);
            break;
          case "activate":
            if (
              message.build !== undefined &&
              typeof message.build !== "string"
            )
              throw new ShellError("E_INVALID", "版本标识无效");
            await database.activate(message.build);
            break;
          case "prune":
            return { ok: true, value: await database.prune() };
          default:
            throw new ShellError("E_INVALID", "未知消息");
        }
        return { ok: true, value: null };
      } catch (error) {
        return { ok: false, error: shellError(error).toJSON() };
      }
    },
  };
}
