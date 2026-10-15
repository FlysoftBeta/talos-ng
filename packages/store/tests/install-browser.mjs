import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(
  new URL("../node_modules/.playwright", import.meta.url),
);
const cli = join(
  dirname(fileURLToPath(import.meta.resolve("playwright/package.json"))),
  "cli.js",
);
const result = spawnSync(process.execPath, [cli, "install", "chromium"], {
  stdio: "inherit",
  env: process.env,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
