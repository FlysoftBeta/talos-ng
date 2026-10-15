// Usage: node tools/e2e/run.mjs [feature ...] [--legacy]
// No feature runs everything in order (pnpm e2e / pnpm e2e:legacy). Build shell and client first.
import { createStaticServer } from "./harness/static-server.mjs";
import { createRealServer } from "./harness/real-server.mjs";
import { launchBrowser } from "./harness/browser.mjs";

const ORDER = [
  "identity",
  "library",
  "netbooks",
  "media",
  "chat",
  "admin",
  "ai",
  "hardening",
  "ops",
  "offline",
];
/** Scenario groups that run inside another feature's session. */
const ALIASES = { learning: "identity", reader: "library", update: "offline" };

const args = process.argv.slice(2);
const legacy = args.includes("--legacy");
const requested = args
  .filter((arg) => !arg.startsWith("--"))
  .map((name) => ALIASES[name] ?? name);
for (const name of requested)
  if (!ORDER.includes(name)) {
    console.error(
      `Unknown feature "${name}". Features: ${ORDER.join(", ")} (aliases: ${Object.keys(ALIASES).join(", ")})`,
    );
    process.exit(2);
  }
const selected = requested.length
  ? ORDER.filter((name) => requested.includes(name))
  : ORDER;

const features = await Promise.all(
  selected.map(
    async (name) => (await import(`./scenarios/${name}/index.mjs`)).default,
  ),
);
const afters = [];
/** A fresh browser per feature: no leaked storage, ServiceWorker, emulation or virtual-time state. */
async function openBrowser() {
  const opened = await launchBrowser({ legacy });
  // Stress option: TALOS_E2E_CPU_THROTTLE=6 slows page CPU to expose timing assumptions.
  const throttle = Number(process.env.TALOS_E2E_CPU_THROTTLE ?? 1);
  if (throttle > 1)
    await opened.adapter.cdp.send("Emulation.setCPUThrottlingRate", {
      rate: throttle,
    });
  return opened;
}
try {
  for (const feature of features) {
    const server =
      feature.server === "real"
        ? await createRealServer()
        : createStaticServer();
    let ctx;
    try {
      await server.start();
      await feature.prepare?.(server);
      ctx = await openBrowser();
      console.log(`[e2e] ${feature.name}${legacy ? " (chrome70)" : ""}`);
      await feature.run(ctx, server);
      if (feature.after) afters.push(feature.after);
    } catch (error) {
      console.error(
        await ctx?.adapter.cdp
          .evaluate("document.body.textContent")
          .catch(() => "Page unavailable"),
      );
      console.error(server.logs);
      throw error;
    } finally {
      await ctx?.close();
      await (server.close ?? server.stop).call(server);
    }
  }
  console.log(
    `${selected.join(", ")} passed (${legacy ? "Chromium 70" : "current Chromium"}).`,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
if (process.exitCode !== 1) for (const after of afters) await after({ legacy });
