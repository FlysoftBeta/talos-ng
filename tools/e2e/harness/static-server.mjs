import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
export const DIST = path.join(ROOT, "packages/client/dist");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Restartable static server; in-memory overrides simulate independently deployed builds. */
export function createStaticServer({
  root = DIST,
  sw = path.join(ROOT, "packages/shell/dist/sw.js"),
} = {}) {
  let server;
  let port = 0;
  const overrides = new Map();
  const requests = [];
  return {
    overrides,
    requests,
    get url() {
      return `http://localhost:${port}`;
    },
    async start() {
      if (server) throw new Error("Server already started");
      server = createServer(async (request, response) => {
        const url = new URL(request.url || "/", "http://localhost");
        requests.push(url.pathname);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Service-Worker-Allowed", "/");
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.writeHead(405).end();
          return;
        }
        if (url.pathname === "/favicon.ico") {
          response.writeHead(204).end();
          return;
        }
        try {
          const pathname = decodeURIComponent(url.pathname);
          if (pathname.includes("\\") || pathname.includes("\0")) {
            response.writeHead(400).end();
            return;
          }
          const override = overrides.get(pathname);
          let bytes;
          let mime;
          if (override) {
            bytes = override.bytes;
            mime = override.mime;
          } else {
            const file =
              pathname === "/sw.js"
                ? sw
                : path.resolve(
                    root,
                    `.${pathname === "/" ? "/index.html" : pathname}`,
                  );
            if (
              pathname !== "/sw.js" &&
              file !== root &&
              !file.startsWith(`${root}${path.sep}`)
            ) {
              response.writeHead(403).end();
              return;
            }
            bytes = await readFile(file);
            mime = MIME[path.extname(file)] || "application/octet-stream";
          }
          response.setHeader("Content-Type", mime);
          response.setHeader("Content-Length", bytes.length);
          response
            .writeHead(200)
            .end(request.method === "HEAD" ? undefined : bytes);
        } catch (error) {
          response
            .writeHead(error.code === "ENOENT" ? 404 : 500)
            .end("Static resource unavailable");
        }
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "localhost", resolve);
      });
      port = server.address().port;
      return this.url;
    },
    async stop() {
      if (!server) return;
      const closing = server;
      server = undefined;
      await new Promise((resolve, reject) => {
        closing.close((error) => (error ? reject(error) : resolve()));
        closing.closeAllConnections();
      });
    },
  };
}
