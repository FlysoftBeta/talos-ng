import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { prepareChromium } from "../../legacy-chromium/prepare.mjs";
import { WAIT_TIMEOUT } from "./wait.mjs";
import { launchChrome } from "../../legacy-chromium/cdp.mjs";
import { LAN_HOST } from "./real-server.mjs";

/** The LAN name of a real server resolves locally; its throwaway certificate is accepted. */
const LAN_ARGS = [
  `--host-resolver-rules=MAP ${LAN_HOST} 127.0.0.1`,
  "--ignore-certificate-errors",
];

/**
 * One browser engine behind the raw-CDP surface every scenario uses:
 * current Playwright Chromium, or a real old Chromium snapshot (`legacy`; `major` 70 by
 * default, 80 for the first version the server sends to HTTPS).
 * `playwright` is the Playwright browser (current only; chat opens extra contexts).
 */
/**
 * Captures must show settled screens: the product animates overlays (120-180 ms), so every
 * test page gets a style that collapses animations and transitions to zero.
 */
export const STILL_MOTION = `(function(){var s=document.createElement('style');s.textContent='*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important}';function add(){var root=document.head||document.documentElement;if(root)root.appendChild(s);else document.addEventListener('readystatechange',add,{once:true});}add();})()`;
export async function launchBrowser({ legacy = false, major = 70 } = {}) {
  if (legacy) {
    const chrome = await prepareChromium(major);
    const adapter = await launchChrome(chrome.executable, LAN_ARGS);
    await adapter.cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: STILL_MOTION,
    });
    const wait = adapter.cdp.wait.bind(adapter.cdp);
    adapter.cdp.wait = (expression, timeout = WAIT_TIMEOUT) =>
      wait(expression, timeout);
    return {
      legacy,
      adapter,
      playwright: undefined,
      describe: `${chrome.version} (official snapshot ${chrome.revision})`,
      close: () => adapter.close(),
    };
  }
  const playwright = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", ...LAN_ARGS],
  });
  const context = await playwright.newContext({ ignoreHTTPSErrors: true });
  await context.addInitScript(STILL_MOTION);
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      errors.push(`${message.text()} (${message.location().url})`);
  });
  const adapter = {
    errors,
    page,
    cdp: {
      send: (method, params) =>
        method === "Emulation.setDeviceMetricsOverride"
          ? page.setViewportSize({ width: params.width, height: params.height })
          : session.send(method, params),
      on: (method, listener) => session.on(method, listener),
      evaluate: (expression) => page.evaluate(expression),
      wait: (expression, timeout = WAIT_TIMEOUT) =>
        page.waitForFunction(expression, undefined, { timeout }),
      navigate: (url) => page.goto(url, { waitUntil: "load" }),
      offline: async (value) => {
        await context.setOffline(value);
        // Chromium 156 resets navigator.onLine on a SW-served navigation when only
        // Playwright's context emulation is used. Keep the page CDP state in sync.
        await session.send("Network.emulateNetworkConditions", {
          offline: value,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
      },
      screenshot: async (file) => {
        await mkdir(path.dirname(file), { recursive: true });
        await page.screenshot({ path: file });
      },
    },
  };
  return {
    legacy,
    adapter,
    playwright,
    describe: `Chromium ${playwright.version()}`,
    close: () => playwright.close(),
  };
}
