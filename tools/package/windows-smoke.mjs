import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  open,
} from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { readZip } from "../../packages/launcher/src/index.ts";
const root = resolve(import.meta.dirname, "../..");
const files = await readdir(join(root, "dist/release"));
const archive =
  process.argv[2] ?? files.find((n) => n.endsWith("-win32-x64.zip"));
if (!archive) throw new Error("Build a Windows package first");
const directory = await mkdtemp(join(tmpdir(), "talos-wine-"));
const env = {
  ...process.env,
  WINEPREFIX: join(directory, "wine"),
  WINEDEBUG: "-all",
  WINEARCH: "win64",
};
const win = (p) => "Z:" + resolve(p).replaceAll("/", "\\");
let child,
  logHandle,
  logs = "";
async function execute(args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const c = spawn("wine", args, {
      cwd: directory,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let text = "";
    c.stdout.on("data", (b) => (text += b));
    c.stderr.on("data", (b) => (text += b));
    const timer = setTimeout(() => {
      c.kill("SIGKILL");
      reject(new Error("Wine timeout: " + text));
    }, timeout);
    c.on("error", reject);
    c.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(text);
      else reject(new Error(`Wine exited ${code}: ${text}`));
    });
  });
}
try {
  const entries = readZip(await readFile(join(root, "dist/release", archive)));
  const names = [...entries.keys()];
  for (const required of ["runtime/node.exe", "start.cmd"])
    assert.ok(entries.has(required), `Missing ${required}`);
  assert.ok(names.some((name) => name.endsWith("/pdfrender.exe")));
  assert.ok(names.some((name) => /pdfrender\/windows\/.*\.dll$/i.test(name)));
  assert.ok(names.some((name) => name.endsWith("/yt-dlp.exe")));
  const manifestName = names.find((name) =>
    name.endsWith("/client/app/manifest.json"),
  );
  assert.ok(manifestName);
  const manifest = JSON.parse(entries.get(manifestName).toString("utf8"));
  const prefix = manifestName.slice(0, -"app/manifest.json".length);
  assert.deepEqual(
    names.filter((name) => name.startsWith(prefix)).sort(),
    [
      prefix + "index.html",
      manifestName,
      ...manifest.assets.map((asset) => prefix + asset.path.slice(1)),
    ].sort(),
    "Windows client contains exactly installable manifest assets",
  );
  console.log(
    `Windows archive inventory verified: ${names.length} entries, ${manifest.assets.length} client assets; no gallery/dev diagnostics.`,
  );
  for (const [name, data] of entries) {
    const target = join(directory, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  console.log(
    "Windows Node:",
    await execute([join(directory, "runtime/node.exe"), "--version"]),
  );
  const build = (await readFile(join(directory, "current"), "utf8")).trim();
  const listener = createServer();
  await new Promise((r) => listener.listen(0, "127.0.0.1", r));
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  await writeFile(
    join(directory, "talos.config.json"),
    JSON.stringify({
      ports: [port],
      securePorts: [],
      bindHost: "127.0.0.1",
      dataDir: "./data",
      dev: true,
      testSeed: true,
    }),
  );
  const wrapper = join(directory, "wine-control.mjs");
  await writeFile(
    wrapper,
    `
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const launcher = process.argv[2], root = process.argv[3];
process.argv = [process.execPath, launcher, root];
const timer = setInterval(() => {
  if (existsSync(join(root, 'wine-stop.request'))) {
    clearInterval(timer); process.emit('SIGTERM');
  }
}, 100);
await import(pathToFileURL(launcher).href);
`,
  );
  // Wine does not reliably expose Linux pipe handles as Windows Node stdio.
  // Regular-file handles exercise shutdown without that harness artifact.
  const logPath = join(directory, "wine-launcher.log");
  logHandle = await open(logPath, "w");
  child = spawn(
    "wine",
    [
      join(directory, "runtime/node.exe"),
      win(wrapper),
      win(join(directory, "launcher.js")),
      win(directory),
    ],
    { cwd: directory, env, stdio: ["ignore", logHandle.fd, logHandle.fd] },
  );
  let served = false;
  const startupDeadline =
    Date.now() + Number(process.env.TALOS_E2E_STARTUP_TIMEOUT_MS ?? 120_000);
  while (Date.now() < startupDeadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`http://127.0.0.1:${port}`);
      if (res.ok) {
        assert.match(await res.text(), /Talos II/);
        served = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  logs = await readFile(logPath, "utf8");
  if (!served)
    throw new Error(
      "Windows packaged launcher/server did not serve client: " + logs,
    );
  console.log("Windows packaged launcher/server served client.");
  const parts = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 20 Tf 20 100 Td (Talos Windows PDF smoke) Tj ET";
  parts.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let pdf = "%PDF-1.4\n",
    offsets = [0];
  parts.forEach((p, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${p}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const input = join(directory, "smoke.pdf"),
    output = join(directory, "smoke.zip");
  await writeFile(input, pdf);
  console.log(
    await execute([
      join(
        directory,
        "releases",
        build,
        "vendor/pdfrender/windows/pdfrender.exe",
      ),
      "--resolution",
      "96",
      "--webp-quality",
      "80",
      "--jobs",
      "1",
      win(input),
      win(output),
    ]),
  );
  const result = await readFile(output);
  assert.ok(result.length > 100);
  assert.equal(result.readUInt32LE(0), 0x04034b50);
  const stopped = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Graceful Wine stop timed out")),
      15000,
    );
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  await writeFile(join(directory, "wine-stop.request"), "shutdown");
  const exitCode = await stopped;
  logs = await readFile(logPath, "utf8");
  assert.equal(
    exitCode,
    0,
    "launcher and IPC server shutdown complete\n" + logs,
  );
  await assert.rejects(readFile(join(directory, "launcher.lock")), {
    code: "ENOENT",
  });
  await assert.rejects(readFile(join(directory, "data", "launcher.lock")), {
    code: "ENOENT",
  });
  assert.match(logs, /服务器已关闭/);
  console.log(
    "Wine only: clean launcher handler / server IPC stop; both locks released.",
  );
  console.log(
    `WINDOWS WINE SMOKE PASSED: server/client and PDF conversion (${result.length} bytes). Office COM and native Windows console close remain untested.`,
  );
} finally {
  if (child) {
    child.kill("SIGTERM");
    await new Promise((r) => {
      if (child.exitCode !== null) r();
      else {
        child.once("exit", r);
        setTimeout(() => {
          child.kill("SIGKILL");
          r();
        }, 5000).unref();
      }
    });
  }
  await logHandle?.close();
  const stop = spawn("wineserver", ["-k"], { env, stdio: "ignore" });
  await new Promise((r) => {
    stop.once("exit", r);
    stop.once("error", r);
  });
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}
