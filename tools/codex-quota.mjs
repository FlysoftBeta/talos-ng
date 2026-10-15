// Prints the Codex rate-limit meter (read-only). Usage: node tools/codex-quota.mjs
import { spawn } from "node:child_process";
const p = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "ignore"] });
let buf = "",
  id = 0;
const wait = new Map();
p.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const l = buf.slice(0, i);
    buf = buf.slice(i + 1);
    try {
      const m = JSON.parse(l);
      if (m.id !== undefined && wait.has(m.id)) {
        wait.get(m.id)(m);
        wait.delete(m.id);
      }
    } catch {}
  }
});
const call = (method, params) =>
  new Promise((r) => {
    const i = ++id;
    wait.set(i, r);
    p.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n",
    );
  });
const j = (x) =>
  JSON.stringify(x, (k, v) => (typeof v === "bigint" ? Number(v) : v), 1);
setTimeout(() => {
  console.log("timeout");
  p.kill();
  process.exit(1);
}, 60000);
await call("initialize", {
  clientInfo: { name: "talos-orchestrator", title: null, version: "0" },
  capabilities: { experimentalApi: true },
});
p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }) + "\n");
const rl = await call("account/rateLimits/read");
console.log(j(rl.result ?? rl.error));
p.kill();
process.exit(0);
