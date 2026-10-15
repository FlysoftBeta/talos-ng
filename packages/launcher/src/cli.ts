import { ChildLogOutput } from "./logging/child-log-output.ts";
import { RotatingLog } from "./logging/rotating-log.ts";
import { fork, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { acquireLock } from "./process/lock.ts";
import { Supervisor } from "./process/supervisor.ts";
import type { ServerChild } from "./process/supervisor.ts";
import { ReleaseFiles } from "./release/release-files.ts";
import { installedTarget, assertTarget, hostTarget } from "./release/target.ts";
const root = resolve(
  process.argv[2] ?? dirname(fileURLToPath(import.meta.url)),
);
const target = installedTarget(root);
assertTarget(hostTarget(), target);
const unlock = await acquireLock(root);
const files = new ReleaseFiles(root);
const log = new RotatingLog(join(root, "data", "logs", "launcher.log"));
let consoleOutput: NodeJS.WriteStream | undefined;
try {
  consoleOutput = process.stdout;
  consoleOutput.on("error", () => {
    consoleOutput = undefined;
  });
} catch {
  /* A detached console may have no stdout. */
}
const supervisor = new Supervisor({
  now: Date.now,
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  read: () => files.read(),
  save: (s) => files.save(s),
  incident: (s) => log.write(`${new Date().toISOString()} ${s}\n`),
  restore: async (backup, previous) => {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [join(root, "releases", previous, "server.js"), "restore", backup],
        {
          cwd: root,
          env: { ...process.env, TALOS_DATA_DIR: join(root, "data") },
          stdio: "inherit",
        },
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("数据库回滚失败")),
      );
    });
  },
  start: async (build): Promise<ServerChild> => {
    const release = join(root, "releases", build);
    const manifest = JSON.parse(
      await readFile(join(release, "release.json"), "utf8"),
    ) as { platform: string };
    assertTarget(manifest.platform, target);
    const state = await files.read();
    const child = fork(join(release, "server.js"), [], {
      cwd: root,
      execArgv: [],
      silent: true,
      env: {
        ...process.env,
        TALOS_BUILD: build,
        TALOS_UPDATE_PENDING: state.pending ? "true" : "false",
        TALOS_DATA_DIR: join(root, "data"),
        TALOS_ASSETS_DIR: join(release, "client"),
        TALOS_WORKER_FILE: join(release, "shell", "sw.js"),
        TALOS_RELEASE_ROOT: release,
        TALOS_LAUNCHER_ROOT: root,
      },
    });
    const stdout = new ChildLogOutput((line) => {
      void log.write(line);
    });
    const stderr = new ChildLogOutput((line) => {
      void log.write(line);
    });
    child.stdout?.on("data", (data: Buffer) => {
      try {
        consoleOutput?.write(data);
      } catch {
        consoleOutput = undefined;
      }
      stdout.push(data);
    });
    child.stdout?.on("end", () => stdout.end());
    child.stderr?.on("data", (data: Buffer) => stderr.push(data));
    child.stderr?.on("end", () => stderr.end());
    child.on("error", (error) => {
      void log.write(String(error));
    });
    child.on("message", (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const m = message as {
        type?: string;
        archive?: string;
        sha256?: string;
        backup?: string;
      };
      if (m.type === "apply" && m.archive && m.sha256 && m.backup) {
        const archive = m.archive,
          sha = m.sha256,
          backup = m.backup;
        void (async () => {
          const bytes = await readFile(archive);
          const next = await files.stage(bytes, sha);
          await supervisor.apply(next, backup);
        })().catch((error) => {
          void log.write(String(error));
          if (child.connected)
            child.send({
              type: "update-failed",
              message: "更新无法应用，请查看启动器日志",
            });
        });
      }
    });
    return {
      onExit: (fn) => {
        child.once("exit", fn);
      },
      onMessage: (fn) => {
        child.on("message", fn);
      },
      stop: () =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
          if (child.connected) child.send({ type: "shutdown" });
          else child.kill("SIGTERM");
        }),
    };
  },
});
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  void supervisor.stop().finally(async () => {
    await log.flush();
    await unlock();
  });
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.on(signal, stop);
try {
  await supervisor.boot();
} catch (error) {
  await log.write(String(error));
  await supervisor.stop();
  await unlock();
  process.exitCode = 1;
}
