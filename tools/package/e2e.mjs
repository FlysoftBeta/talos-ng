import { checkLinuxStructure } from "./structure.mjs";
import { hostTarget } from "../../packages/launcher/src/release/target.ts";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  chmod,
  rm,
} from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import { request } from "node:https";
import { createApi } from "../../packages/contract/src/index.ts";
import { LinkClient } from "../../packages/link/src/index.ts";
import {
  connectNodeWebSocket,
  nodeWebSocketCarrier,
} from "../../packages/link/src/ws-node/index.ts";
import {
  digest,
  writeZip,
  verifyRelease,
} from "../../packages/launcher/src/index.ts";
import { Db } from "../../packages/server/src/kernel/persistence/db.ts";
const { chromium } = createRequire(
  new URL("../e2e/package.json", import.meta.url),
)("playwright");
const { WebSocket } = createRequire(
  new URL("../../packages/link/package.json", import.meta.url),
)("ws");
const root = resolve(import.meta.dirname, "../..");
// Full releases, staged updates and rollback backups can exhaust a shared tmpfs.
const installation = await mkdtemp(
  join(process.env.TALOS_PACKAGE_E2E_TMPDIR ?? tmpdir(), "talos-package-e2e-"),
);
const target = hostTarget();
const otherTarget =
  target === "linux-redhat-x64" ? "linux-debian-x64" : "linux-redhat-x64";
const A = "ops-e2e-A",
  B = "ops-e2e-B",
  C = "ops-e2e-C";
async function run(file, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: root,
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${file} exited ${code}`)),
    );
  });
}
async function eventually(read, accept, label, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    let result;
    try {
      result = await read();
    } catch {}
    if (accept(result)) return result;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timeout: ${label}`);
}
async function port() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function connect(url, pin = "123456", ca) {
  let client;
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Link handshake timeout")),
      10000,
    );
    client = new LinkClient({
      connect: () =>
        ca
          ? new Promise((resolve, reject) => {
              const socket = new WebSocket(url, { ca });
              socket.once("error", reject);
              socket.once("open", () => resolve(nodeWebSocketCarrier(socket)));
            })
          : connectNodeWebSocket(url),
      hello: () => ({ v: 1, build: A, device: null, lang: "zh-CN" }),
    });
    client.onWelcome((w) => {
      clearTimeout(timeout);
      resolve(w);
    });
    client.start();
  });
  await ready;
  const api = createApi(client.call.bind(client));
  await api.auth.device.register({ label: "package e2e" });
  await api.auth.login({ pin });
  return { client, api };
}
let launcher,
  browser,
  connection,
  logs = "";
async function stopLauncher() {
  if (!launcher) return;
  const child = launcher;
  launcher = undefined;
  child.kill("SIGTERM");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Launcher shutdown timed out"));
    }, 15000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
try {
  for (const name of ["@talos/server", "@talos/launcher", "@talos/shell"])
    await run("pnpm", ["--filter", name, "build"]);
  for (const build of [A, B]) {
    const env = {
      ...process.env,
      TALOS_BUILD_ID: build,
      TALOS_PACKAGE_TARGET: target,
    };
    await run("pnpm", ["--filter", "@talos/client", "build"], { env });
    await run(
      process.execPath,
      ["--experimental-transform-types", "tools/package/build.ts"],
      { env },
    );
  }
  await run(
    process.execPath,
    ["--experimental-transform-types", "tools/package/build.ts"],
    {
      env: { ...process.env, TALOS_PACKAGE_TARGET: otherTarget },
    },
  );
  await checkLinuxStructure(root, B, otherTarget, target);
  await checkLinuxStructure(root, B, target, otherTarget);
  const tar = gunzipSync(
    await readFile(join(root, "dist/release", `talos-${A}-${target}.tar.gz`)),
  );
  for (let p = 0; p + 512 <= tar.length;) {
    const tail = tar
      .subarray(p, p + 100)
      .toString()
      .replace(/\0.*$/s, "");
    if (!tail) break;
    const prefix = tar
      .subarray(p + 345, p + 500)
      .toString()
      .replace(/\0.*$/s, "");
    const name = prefix ? prefix + "/" + tail : tail;
    const size = parseInt(tar.subarray(p + 124, p + 136).toString(), 8);
    const path = join(installation, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, tar.subarray(p + 512, p + 512 + size));
    await chmod(path, parseInt(tar.subarray(p + 100, p + 108).toString(), 8));
    p += 512 + Math.ceil(size / 512) * 512;
  }
  const http = await port(),
    https = await port();
  const url = `http://localhost:${http}`;
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(installation, "key.pem"),
      "-out",
      join(installation, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { stdio: "ignore" },
  );
  await writeFile(
    join(installation, "talos.config.json"),
    JSON.stringify({
      ports: [http],
      securePorts: [https],
      bindHost: "127.0.0.1",
      dataDir: "./data",
      dev: true,
      testSeed: true,
      https: {
        cert: "cert.pem",
        key: "key.pem",
        ca: "cert.pem",
        domain: "localhost",
        redirect: false,
      },
    }),
  );
  launcher = spawn(
    join(installation, "runtime/node"),
    [join(installation, "launcher.js"), installation],
    { cwd: installation, stdio: ["ignore", "pipe", "pipe"] },
  );
  launcher.stdout.on("data", (b) => {
    logs += b;
  });
  launcher.stderr.on("data", (b) => {
    logs += b;
  });
  await eventually(
    () => fetch(url + "/app/manifest.json").then((r) => r.json()),
    (m) => m?.build === A,
    "A ready",
    Number(process.env.TALOS_E2E_STARTUP_TIMEOUT_MS ?? 120_000),
  );
  const ca = await readFile(join(installation, "cert.pem"));
  const html = await new Promise((resolve, reject) => {
    request({ hostname: "localhost", port: https, path: "/", ca }, (res) => {
      let text = "";
      res.on("data", (b) => (text += b));
      res.on("end", () => resolve(text));
    })
      .on("error", reject)
      .end();
  });
  assert.match(html, /Talos II/);
  const secure = await connect(`wss://localhost:${https}/link`, "123456", ca);
  assert.equal((await secure.api.sys.info({})).build, A);
  secure.client.stop();
  connection = await connect(`ws://localhost:${http}/link`);
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  const signIn = async () => {
    await page.waitForFunction(
      '!!document.querySelector(\'[data-testid="app.ready"],[data-testid="auth.concealed"],[data-testid="auth.numpad"] button\')',
    );
    if (await page.locator('[data-testid="app.ready"]').count()) return;
    if (await page.locator('[data-testid="auth.concealed"]').count())
      for (const key of "Up Up Down Down Left Right Left Right".split(" "))
        await page.keyboard.press(`Arrow${key}`);
    await page.locator('[data-testid="auth.numpad"] button').first().waitFor();
    for (const digit of "123456")
      await page
        .locator('[data-testid="auth.numpad"]')
        .getByRole("button", { name: digit, exact: true })
        .click();
  };
  await signIn();
  await page.locator('[data-testid="app.ready"]').waitFor();
  await page.waitForFunction(
    "window.__talosShell && navigator.serviceWorker.controller",
  );
  async function upload(bytes) {
    const begin = await connection.api.upload.begin({
      kind: "file",
      size: bytes.length,
    });
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024)
      await connection.api.upload.append(
        { id: begin.id, offset },
        { body: bytes.subarray(offset, offset + 512 * 1024) },
      );
    await connection.api.upload.commit({ id: begin.id });
    return begin.id;
  }
  const objectBytes = Buffer.from("打包端到端对象"),
    objectUpload = await upload(objectBytes);
  const updateB = await readFile(
    join(root, "dist/release", `talos-${B}-${target}-update.zip`),
  );
  const wrongUpdate = await readFile(
    join(root, "dist/release", `talos-${B}-${otherTarget}-update.zip`),
  );
  await assert.rejects(
    connection.api.ops.update.stage(
      { upload: await upload(wrongUpdate) },
      { timeoutMs: 300000 },
    ),
    /Update target mismatch/,
  );
  const uploadB = await upload(updateB);
  await connection.api.ops.update.stage(
    { upload: uploadB },
    { timeoutMs: 300000 },
  );
  assert.equal((await connection.api.ops.update.apply({})).ok, true);
  connection.client.stop();
  await eventually(
    () => fetch(url + "/app/manifest.json").then((r) => r.json()),
    (m) => m?.build === B,
    "B ready",
  );
  await page.locator(`[data-testid="ui.status"]`).first().click();
  await page
    .getByRole("button", { name: "应用新版本", exact: true })
    .waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "应用新版本", exact: true }).click();
  await page.waitForFunction(
    `document.querySelector('meta[name="talos-build"]').content===${JSON.stringify(B)}`,
  );
  connection = await connect(`ws://localhost:${http}/link`);
  await signIn();
  await page.locator('[data-testid="app.ready"]').waitFor();
  if (await page.getByRole("dialog").count())
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .first()
      .click();
  for (const label of ["管理", "运维 · 更新"]) {
    const button = page
      .locator(`button[aria-label="${label}"], button:text-is("${label}")`)
      .first();
    await button.waitFor();
    await button.click();
  }
  await page.getByRole("button", { name: "确认当前版本", exact: true }).click();
  await eventually(
    () =>
      readFile(join(installation, "launcher-state.json"), "utf8").then(
        JSON.parse,
      ),
    (s) => s?.current === B && !s.pending,
    "B confirmed",
  );
  // The same packaged B payload, with a deliberately failing server and fresh manifest hashes.
  const { files, manifest } = verifyRelease(updateB);
  files.set("server.js", Buffer.from("process.exit(9);"));
  manifest.build = C;
  manifest.files = [...files]
    .filter(([name]) => name !== "release.json")
    .map(([path, b]) => ({ path, size: b.length, sha256: digest(b) }));
  files.set("release.json", Buffer.from(JSON.stringify(manifest)));
  const broken = writeZip(files);
  await connection.api.ops.update.stage(
    { upload: await upload(broken) },
    { timeoutMs: 300000 },
  );
  await connection.api.ops.update.apply({});
  connection.client.stop();
  await eventually(
    () => readFile(join(installation, "data/logs/launcher.log"), "utf8"),
    (s) => s?.includes(`回滚 ${C}`),
    "C rolled back",
  );
  await eventually(
    () => fetch(url + "/app/manifest.json").then((r) => r.json()),
    (m) => m?.build === B,
    "B restored",
  );
  connection = await connect(`ws://localhost:${http}/link`);
  const backup = await connection.api.ops.backup.create(
    {},
    { timeoutMs: 300000 },
  );
  const user = (await connection.api.auth.login({ pin: "123456" })).user.id;
  // A normal setting mutation gives the restore an observable database delta.
  await connection.api.me.setting.set({
    key: "ops-e2e",
    value: {
      v: "mutated",
      t: { ms: Date.now(), counter: 0 },
      op: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    },
  });
  connection.client.stop();
  connection = undefined;
  await browser.close();
  browser = undefined;
  await stopLauncher();
  await run(
    join(installation, "runtime/node"),
    [
      join(installation, "releases", B, "server.js"),
      "restore",
      join(installation, "data/backups", backup.id + ".backup"),
    ],
    { cwd: installation },
  );
  const db = new Db(join(installation, "data/talos.db"));
  try {
    assert.equal(
      db.get(
        "SELECT 1 FROM me_settings WHERE user_id=? AND key='ops-e2e'",
        user,
      ),
      undefined,
    );
    const stored = db.get(
      "SELECT object_id FROM uploads WHERE id=?",
      objectUpload,
    );
    assert.ok(stored);
    const object = stored.object_id;
    assert.deepEqual(
      await readFile(
        join(
          installation,
          "data/objects",
          object.slice(0, 2),
          object.slice(2, 4),
          object,
        ),
      ),
      objectBytes,
    );
  } finally {
    db.close();
  }
  console.log(
    "PACKAGED E2E PASSED: Linux A → confirmed B → broken C rollback, WELCOME/SW install, SQLite+objects restore, generated HTTPS + WSS.",
  );
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  connection?.client.stop();
  await browser?.close();
  await stopLauncher();
  if (!process.env.TALOS_KEEP_E2E)
    await rm(installation, { recursive: true, force: true });
  else console.log(installation);
}
