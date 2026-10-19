import { createSecureContext } from "node:tls";
import type { Server as HttpsServer } from "node:https";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer as createSecureServer } from "node:https";
import type { ServerOptions } from "node:https";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError } from "@talos/base";
import { attachWebSocketServer } from "@talos/link/ws-node";
import type { WebSocketListenerOptions } from "@talos/link/ws-node";
import type { ObjectStore } from "@talos/objectstore";
import type { TicketService } from "../objects/tickets.ts";
import type { HttpAssets } from "./http-assets.ts";
import { loadHttpAssets } from "./http-assets.ts";
import { parseHttpRange } from "./http-range.ts";

export interface HttpGatewayOptions {
  ports: readonly number[];
  securePorts?: readonly number[];
  bindHost?: string;
  assetsDir?: string;
  workerFile?: string;
  assets?: HttpAssets;
  build: string;
  store: ObjectStore;
  tickets: TicketService;
  tls?: ServerOptions;
  ca?: Uint8Array;
  /** Trusted configured domain, never the request's Host header. */
  redirect?: { domain: string; port?: number };
  onConnection?: WebSocketListenerOptions["onConnection"];
  reportError?: (error: unknown) => void;
}
export interface HttpGateway {
  readonly addresses: readonly {
    port: number;
    secure: boolean;
    host: string;
  }[];
  reloadTls(tls: ServerOptions, ca?: Uint8Array): void;
  stopAccepting(): void;
  close(): Promise<void>;
}
/**
 * Only Chromium 80+ is sent to HTTPS; older managed tablets may not trust the certificate
 * and keep working over HTTP (without a ServiceWorker).
 */
function redirectsToHttps(userAgent: string | undefined): boolean {
  const major = /(?:Chrome|Chromium)\/(\d+)/.exec(userAgent ?? "")?.[1];
  return major !== undefined && Number(major) >= 80;
}

export async function startHttpGateway(
  options: HttpGatewayOptions,
): Promise<HttpGateway> {
  for (const port of [...options.ports, ...(options.securePorts ?? [])]) {
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
      throw new AppError("E_INVALID", "无效的 HTTP 端口");
  }
  if (
    options.redirect?.port !== undefined &&
    (!Number.isSafeInteger(options.redirect.port) ||
      options.redirect.port < 1 ||
      options.redirect.port > 65535)
  )
    throw new AppError("E_INVALID", "无效的 HTTPS 端口");
  const assets =
    options.assets ??
    (await loadHttpAssets(
      options.assetsDir,
      options.build,
      options.workerFile,
    ));
  const manifest = Buffer.from(JSON.stringify(assets.manifest));
  const servers: Server[] = [];
  const sockets: { close(): Promise<void> }[] = [];
  const addresses: { port: number; secure: boolean; host: string }[] = [];
  const closing: Promise<void>[] = [];
  let stopped = false;
  if ((options.securePorts?.length ?? 0) > 0 && !options.tls)
    throw new AppError("E_INVALID", "HTTPS 需要证书配置");
  if (options.redirect && !/^[A-Za-z0-9.-]+$/.test(options.redirect.domain))
    throw new AppError("E_INVALID", "无效的 HTTPS 域名");
  const dispatch = async (
    req: IncomingMessage,
    res: ServerResponse,
    secure: boolean,
  ): Promise<void> => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }
    const raw = req.url?.split("?")[0] ?? "/";
    let path: string;
    try {
      path = decodeURIComponent(raw);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (
      !path.startsWith("/") ||
      path.startsWith("//") ||
      /[\\\x00-\x1f]/.test(path) ||
      path.split("/").some((p) => p === ".." || p === ".")
    ) {
      res.writeHead(400);
      res.end();
      return;
    }
    if (
      !secure &&
      options.redirect &&
      path !== "/ca.crt" &&
      redirectsToHttps(req.headers["user-agent"])
    ) {
      const port = options.redirect.port ?? options.securePorts?.[0] ?? 443;
      res.writeHead(301, {
        Location: `https://${options.redirect.domain}${port === 443 ? "" : `:${port}`}${req.url}`,
      });
      res.end();
      return;
    }
    const send = (bytes: Uint8Array, mime: string, cache = "no-store") => {
      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": bytes.length,
        "Cache-Control": cache,
      });
      res.end(req.method === "HEAD" ? undefined : bytes);
    };
    if (path === "/app/manifest.json") {
      send(manifest, "application/json; charset=utf-8");
      return;
    }
    if (path === "/ca.crt" && options.ca) {
      send(options.ca, "application/x-x509-ca-cert");
      return;
    }
    if (path === "/link") {
      res.writeHead(426, { Upgrade: "websocket" });
      res.end();
      return;
    }
    if (path.startsWith("/dl/")) {
      const ticket = await options.tickets.resolve(path.slice(4));
      const object =
        ticket.source ?? (await options.store.stat(ticket.objectId));
      if (!object) throw new AppError("E_NOT_FOUND", "下载对象不存在");
      let range;
      if (req.headers.range && ticket.source) {
        res.writeHead(416, { "Content-Range": `bytes */${object.size}` });
        res.end();
        return;
      }
      if (req.headers.range) {
        try {
          range = parseHttpRange(req.headers.range, object.size);
        } catch {
          res.writeHead(416, { "Content-Range": `bytes */${object.size}` });
          res.end();
          return;
        }
      }
      const filename = ticket.filename.replace(/[^\x20-\x7e]|["\\/]/g, "_");
      res.setHeader("Accept-Ranges", ticket.source ? "none" : "bytes");
      res.setHeader("Content-Type", ticket.mime);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(ticket.filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      );
      res.setHeader(
        "Content-Length",
        range ? range.end - range.start : object.size,
      );
      if (range)
        res.setHeader(
          "Content-Range",
          `bytes ${range.start}-${range.end - 1}/${object.size}`,
        );
      res.statusCode = range ? 206 : 200;
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      await pipeline(
        Readable.from(
          ticket.source
            ? ticket.source.read()
            : options.store.read(ticket.objectId, range),
        ),
        res,
      );
      return;
    }
    if (path === "/" && !assets.files.has("/")) {
      const message = Buffer.from(
        "Talos II 客户端尚未构建。请先运行 pnpm build，然后重新启动服务器。\n",
        "utf8",
      );
      res.writeHead(503, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": message.length,
      });
      res.end(req.method === "HEAD" ? undefined : message);
      return;
    }
    if (path === "/sw.js") res.setHeader("Service-Worker-Allowed", "/");
    const asset = assets.files.get(path);
    if (asset) {
      send(
        asset.bytes,
        asset.mime,
        path.startsWith(`/app/${assets.manifest.build}/`)
          ? "public, max-age=31536000, immutable"
          : "no-store",
      );
      return;
    }
    // Endpoint namespaces keep a real 404; any other path is a stray link into the app.
    if (
      path.startsWith("/app/") ||
      path.startsWith("/dl/") ||
      path === "/ca.crt" ||
      path === "/sw.js"
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(301, { Location: "/" });
    res.end();
  };
  const gateway: HttpGateway = {
    addresses,
    reloadTls(tls, ca) {
      createSecureContext(tls); // validate the entire new key pair before replacing any listener
      for (const server of servers)
        if ("setSecureContext" in server)
          (server as HttpsServer).setSecureContext(tls);
      options.ca = ca;
    },
    stopAccepting() {
      if (stopped) return;
      stopped = true;
      for (const server of servers) {
        closing.push(
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeIdleConnections();
          }),
        );
      }
    },
    async close() {
      gateway.stopAccepting();
      await Promise.all(sockets.map((socket) => socket.close()));
      for (const server of servers) server.closeAllConnections();
      await Promise.all(closing);
    },
  };
  try {
    for (const secure of [false, true])
      for (const port of secure ? (options.securePorts ?? []) : options.ports) {
        const handler = (req: IncomingMessage, res: ServerResponse) => {
          void dispatch(req, res, secure).catch((error) => {
            if (!(error instanceof AppError) || error.code === "E_INTERNAL")
              options.reportError?.(error);
            if (res.headersSent) {
              res.destroy();
              return;
            }
            res.writeHead(
              error instanceof AppError && error.code === "E_NOT_FOUND"
                ? 404
                : error instanceof AppError && error.code === "E_DENIED"
                  ? 403
                  : 500,
            );
            res.end();
          });
        };
        const server = secure
          ? createSecureServer(options.tls ?? {}, handler)
          : createServer(handler);
        servers.push(server);
        if (options.onConnection)
          sockets.push(
            attachWebSocketServer({
              server,
              path: "/link",
              onConnection: options.onConnection,
            }),
          );
        server.on("upgrade", (request, socket) => {
          if (!options.onConnection || request.url?.split("?")[0] !== "/link")
            socket.destroy();
        });
        await new Promise<void>((resolve, reject) => {
          const failed = (error: Error) =>
            reject(
              AppError.wrap(
                "E_UNAVAILABLE",
                `无法监听 HTTP 端口 ${options.bindHost ?? "127.0.0.1"}:${port}`,
                error,
              ),
            );
          server.once("error", failed);
          server.listen(port, options.bindHost ?? "127.0.0.1", () => {
            server.off("error", failed);
            resolve();
          });
        });
        server.on("error", (error) => options.reportError?.(error));
        const address = server.address();
        if (address && typeof address !== "string")
          addresses.push({ port: address.port, host: address.address, secure });
      }
    return gateway;
  } catch (error) {
    await gateway.close();
    throw error instanceof AppError
      ? error
      : new AppError("E_UNAVAILABLE", "无法启动 HTTP 服务");
  }
}
