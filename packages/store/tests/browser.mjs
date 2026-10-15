import { crossTab } from "./cross-tab.mjs";
import { build } from "esbuild";

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(
  new URL("../node_modules/.playwright", import.meta.url),
);
const { chromium } = await import("playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
  absWorkingDir: root,
  entryPoints: ["tests/browser-entry.ts"],
  bundle: true,
  write: false,
  format: "iife",
  target: ["chrome70", "es2018"],
  alias: {
    vitest: fileURLToPath(new URL("browser-runner.ts", import.meta.url)),
  },
});
const server = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<html><script>${bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></html>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(error));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const results = await page.evaluate(() => window.storeResults);
  console.log(
    `Chromium: ${results.passed} passed, ${results.failed.length} failed`,
  );
  for (const failure of results.failed) console.error(failure);
  if (results.failed.length) process.exitCode = 1;
  await crossTab(context, `http://127.0.0.1:${server.address().port}`);
  console.log("Chromium: cross-tab notifications and writer/GC fencing passed");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
