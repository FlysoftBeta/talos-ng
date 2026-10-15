import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { DIST, ROOT } from "./static-server.mjs";
import { eventually } from "./wait.mjs";
const execFileAsync = promisify(execFile);

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

/** Owns an isolated real server process, release directory, and durable test database. */
export async function createRealServer() {
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
  let child;
  let logs = "";
  const url = `http://localhost:${port}`;
  return {
    url,
    data,
    assets,
    get logs() {
      return logs;
    },
    async start() {
      if (child) throw new Error("Server already started");
      child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          path.join(ROOT, "packages/server/bin/testing/server.ts"),
          "--dev",
        ],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            TALOS_PORTS: String(port),
            TALOS_BIND_HOST: "127.0.0.1",
            TALOS_DATA_DIR: data,
            TALOS_ASSETS_DIR: assets,
            TALOS_WORKER_FILE: path.join(ROOT, "packages/shell/dist/sw.js"),
            TALOS_DEV: "true",
            TALOS_TEST_SEED: "true",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
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
    async seedLearning() {
      const file = path.join(directory, "learning-seed.txt");
      await writeFile(
        file,
        Array.from({ length: 16 }, (_, n) => `word${n}#释义${n}`).join("￥"),
      );
      await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          path.join(ROOT, "packages/server/bin/learning-seed.ts"),
          path.join(data, "talos.db"),
          file,
        ],
        { cwd: ROOT },
      );
    },
    learningAnswers(handle) {
      const db = new DatabaseSync(path.join(data, "talos.db"), {
        readOnly: true,
      });
      try {
        const rows = db
          .prepare(
            "SELECT body FROM learning_progress WHERE user_id=(SELECT id FROM users WHERE handle=?)",
          )
          .all(handle);
        return rows.reduce(
          (sum, row) =>
            sum +
            Object.values(JSON.parse(row.body).devices).reduce(
              (n, counter) => n + counter.answered,
              0,
            ),
          0,
        );
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
