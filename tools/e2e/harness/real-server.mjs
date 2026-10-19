import { execFileSync, fork } from "node:child_process";
import { createServer } from "node:net";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { sendStart } from "../../../packages/launcher/src/process/server-start.ts";
import { DIST, ROOT } from "./static-server.mjs";
import { eventually } from "./wait.mjs";

async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve, reject) =>
    socket.close((e) => (e ? reject(e) : resolve())),
  );
  return port;
}

/** Name the browser resolves to 127.0.0.1 (see launchBrowser): a LAN-like, non-loopback origin. */
export const LAN_HOST = "talos.test";

/**
 * Owns an isolated real server process, release directory, and durable test database.
 * `https` adds a TLS listener for LAN_HOST with a throwaway self-signed certificate and the
 * operator redirect, like a school deployment: `lanUrl` is the plain HTTP address tablets
 * are given, `secureUrl` where Chromium 80+ is sent. `url` stays the local HTTP address for
 * the harness's own clients (Node is never redirected).
 */
export async function createRealServer({ https = false } = {}) {
  const startupTimeout = Number(
    process.env.TALOS_E2E_STARTUP_TIMEOUT_MS ?? 120_000,
  );
  if (!Number.isSafeInteger(startupTimeout) || startupTimeout <= 0)
    throw new Error("TALOS_E2E_STARTUP_TIMEOUT_MS must be a positive integer");
  const directory = await mkdtemp(path.join(tmpdir(), "talos-real-e2e-"));
  const assets = path.join(directory, "client");
  const data = path.join(directory, "data");
  try {
    await cp(DIST, assets, { recursive: true });
  } catch (error) {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    throw error;
  }
  const port = await freePort();
  const securePort = https ? await freePort() : undefined;
  let child;
  let logs = "";
  const url = `http://localhost:${port}`;
  return {
    url,
    lanUrl: `http://${LAN_HOST}:${port}`,
    secureUrl: https ? `https://${LAN_HOST}:${securePort}` : undefined,
    data,
    assets,
    get logs() {
      return logs;
    },
    async start() {
      if (child) throw new Error("Server already started");
      // Operator settings and placement come from a real config directory;
      // the rest is wiring. Paths are absolute: the child's cwd is the repo.
      const configDir = path.join(directory, "config");
      await mkdir(configDir, { recursive: true });
      if (https) {
        execFileSync(
          "openssl",
          [
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            path.join(configDir, "key.pem"),
            "-out",
            path.join(configDir, "cert.pem"),
            "-days",
            "1",
            "-subj",
            `/CN=${LAN_HOST}`,
            "-addext",
            `subjectAltName=DNS:${LAN_HOST}`,
          ],
          { stdio: "ignore" },
        );
      }
      await writeFile(
        path.join(configDir, "config.json"),
        JSON.stringify({
          ports: [port],
          ...(https
            ? {
                securePorts: [securePort],
                https: {
                  cert: path.join(configDir, "cert.pem"),
                  key: path.join(configDir, "key.pem"),
                  domain: LAN_HOST,
                  redirect: true,
                },
              }
            : {}),
          bindHost: "127.0.0.1",
          dataDir: data,
          logsDir: path.join(directory, "logs"),
          tmpDir: path.join(directory, "tmp"),
        }),
      );
      child = fork(
        path.join(ROOT, "packages/server/bin/testing/server.ts"),
        [],
        {
          cwd: ROOT,
          execArgv: ["--import", "tsx"],
          silent: true,
        },
      );
      sendStart(child, {
        configDir,
        assetsDir: assets,
        workerFile: path.join(ROOT, "packages/shell/dist/sw.js"),
        dev: true,
        testSeed: true,
        printRootPin: false,
      });
      child.stdout.on("data", (chunk) => {
        logs += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        logs += String(chunk);
      });
      let spawnError;
      child.once("error", (error) => {
        spawnError = error;
      });
      await eventually(
        async () => {
          if (spawnError) throw spawnError;
          if (child.exitCode !== null)
            throw new Error(`Server exited ${child.exitCode}: ${logs}`);
          try {
            return (await fetch(url)).status;
          } catch {
            return 0;
          }
        },
        (status) => status === 200,
        "real server ready",
        startupTimeout,
      ).catch((error) => {
        throw new Error(`${error.message}\nServer output:\n${logs}`, {
          cause: error,
        });
      });
    },
    async stop() {
      if (!child) return;
      const closing = child;
      child = undefined;
      if (closing.exitCode !== null || closing.signalCode !== null) return;
      await new Promise((resolve) => {
        const timer = setTimeout(() => closing.kill("SIGKILL"), 5000);
        closing.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        closing.kill("SIGTERM");
      });
    },
    readSetting(key) {
      const db = new DatabaseSync(path.join(data, "talos.db"), {
        readOnly: true,
      });
      try {
        const row = db
          .prepare(
            "SELECT value FROM me_settings WHERE key=? ORDER BY rev DESC LIMIT 1",
          )
          .get(key);
        return row ? JSON.parse(row.value).v : undefined;
      } finally {
        db.close();
      }
    },
    fixtureDevice({ banned = false, clearThrottle = false } = {}) {
      const db = new DatabaseSync(path.join(data, "talos.db"));
      try {
        db.prepare("UPDATE devices SET banned=?").run(banned ? 1 : 0);
        if (clearThrottle) {
          db.exec(
            "UPDATE devices SET failures=0,blocked_until=0; DELETE FROM identity_ip_throttle",
          );
        }
      } finally {
        db.close();
      }
    },
    readUser(handle) {
      const db = new DatabaseSync(path.join(data, "talos.db"), {
        readOnly: true,
      });
      try {
        return db
          .prepare("SELECT id,handle,name FROM users WHERE handle=?")
          .get(handle);
      } finally {
        db.close();
      }
    },
    revokeSessions() {
      const db = new DatabaseSync(path.join(data, "talos.db"));
      try {
        db.exec("DELETE FROM sessions");
      } finally {
        db.close();
      }
    },
    sessionCount() {
      const db = new DatabaseSync(path.join(data, "talos.db"), {
        readOnly: true,
      });
      try {
        return db.prepare("SELECT count(*) AS n FROM sessions").get().n;
      } finally {
        db.close();
      }
    },
    async stageRelease(build, broken = false) {
      return stageReleaseAssets(assets, build, broken);
    },
    async close() {
      await this.stop();
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    },
  };
}

/** Derive a complete independently identified release, rehashing every changed asset. */
export async function stageReleaseAssets(assets, build, broken = false) {
  const file = path.join(assets, "app/manifest.json");
  const before = JSON.parse(await readFile(file, "utf8"));
  const entries = [];
  for (const asset of before.assets) {
    const source = await readFile(path.join(assets, asset.path));
    const pathname = asset.path.replace(
      `/app/${before.build}/`,
      `/app/${build}/`,
    );
    const bytes =
      broken && pathname.endsWith("/index.html")
        ? Buffer.from(
            `<html><body data-broken="true">Unconfirmed build</body></html>`,
          )
        : /(?:javascript|text\/|json)/.test(asset.mime)
          ? Buffer.from(source.toString("utf8").split(before.build).join(build))
          : source;
    const target = path.join(assets, pathname);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    entries.push({
      ...asset,
      path: pathname,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    if (pathname.endsWith("/index.html"))
      await writeFile(path.join(assets, "index.html"), bytes);
  }
  await writeFile(file, JSON.stringify({ ...before, build, assets: entries }));
  return build;
}
