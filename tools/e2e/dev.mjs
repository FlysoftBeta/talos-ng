import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  configDirectory,
  readInstallLayout,
} from "../../packages/launcher/src/install/layout.ts";
import { sendStart } from "../../packages/launcher/src/process/server-start.ts";
import { loadSettings } from "../../packages/server/src/kernel/config/config.ts";
import { installedYtDlp } from "../package/media-binary.ts";

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
// A checkout runs from the committed dev-config/, which places data, logs
// and tmp under the git-ignored dev-data/.
const configDir = configDirectory(process.argv[2] ?? "dev-config", root);
const settings = await loadSettings(
  await readInstallLayout(configDir, root),
  root,
);
if (!settings.ports[0])
  throw new Error(
    "pnpm dev requires a nonzero HTTP port in config/config.json",
  );
const host =
  settings.bindHost === "0.0.0.0" || settings.bindHost === "::"
    ? "127.0.0.1"
    : settings.bindHost;
const backend = `http://${host.includes(":") ? `[${host}]` : host}:${settings.ports[0]}`;
// Music works without setup: the pinned yt-dlp is fetched once into the cache
// that packaging uses. Offline, the server still starts, without music.
let ytDlp = null;
try {
  ytDlp = await installedYtDlp();
  if (!ytDlp) console.warn("No pinned yt-dlp for this platform; music is off.");
} catch (error) {
  console.warn(`yt-dlp unavailable, music is off: ${error.message}`);
}
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
const child = fork(join(root, "packages/server/bin/talos-server.ts"), [], {
  cwd: root,
  execArgv: ["--import", "tsx"],
  stdio: "inherit",
});
sendStart(child, {
  configDir,
  assetsDir: join(root, "packages/client/dist"),
  workerFile: join(root, "packages/shell/dist/sw.js"),
  dev: true,
  ...(ytDlp
    ? {
        ytDlp,
        pluginDir: join(root, "packages/server/ytdlp-plugin"),
      }
    : {}),
});
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
