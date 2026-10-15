import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../../packages/server/src/kernel/config/config.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const clientRoot = fileURLToPath(
  new URL("../../packages/client/", import.meta.url),
);
const requireClient = createRequire(
  new URL("../../packages/client/package.json", import.meta.url),
);
const { createServer } = await import(
  pathToFileURL(requireClient.resolve("vite")).href
);
const config = await loadConfig(undefined, {
  ...process.env,
  TALOS_DEV: "true",
});
if (!config.ports[0])
  throw new Error("pnpm dev requires a nonzero HTTP port in TALOS_PORTS");
const host =
  config.bindHost === "0.0.0.0" || config.bindHost === "::"
    ? "127.0.0.1"
    : config.bindHost;
const backend = `http://${host.includes(":") ? `[${host}]` : host}:${config.ports[0]}`;
const vite = await createServer({
  root: clientRoot,
  server: {
    host: "127.0.0.1",
    proxy: Object.fromEntries(
      ["/link", "/dl", "/app", "/sw.js", "/ca.crt"].map((path) => [
        path,
        { target: backend, ws: path === "/link" },
      ]),
    ),
  },
});
const child = spawn(
  process.execPath,
  [
    "--experimental-transform-types",
    "packages/server/bin/talos-server.ts",
    "--dev",
  ],
  { cwd: root, env: process.env, stdio: "inherit" },
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child.kill("SIGTERM");
  await vite.close();
}
child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
  void stop();
});
child.once("exit", (code) => {
  if (!stopping) {
    process.exitCode = code || 1;
    void stop();
  }
});
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
try {
  await vite.listen();
  vite.printUrls();
} catch (error) {
  await stop();
  throw error;
}
