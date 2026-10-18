import { ChildLogOutput } from "./logging/child-log-output.ts";
import { RotatingLog } from "./logging/rotating-log.ts";
import { fork, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { configDirectory, readInstallLayout } from "./install/layout.ts";
import { acquireLock } from "./process/lock.ts";
import { Supervisor } from "./process/supervisor.ts";
import type { ServerChild } from "./process/supervisor.ts";
import { sendStart } from "./process/server-start.ts";
import { ReleaseFiles } from "./release/release-files.ts";
import { installedTarget, assertTarget, hostTarget } from "./release/target.ts";
// The working directory is the install root (install/layout.ts); the only
// argument is the config directory.
const root = process.cwd();
const configDir = configDirectory(process.argv[2]);
let consoleOutput: NodeJS.WriteStream | undefined;
try {
  consoleOutput = process.stdout;
  consoleOutput.on("error", () => {
    consoleOutput = undefined;
  });
} catch {
  /* A detached console may have no stdout. */
}
/** Everything the launcher or the server reports reaches the console as well as the log. */
function echo(data: string | Uint8Array): void {
  try {
    consoleOutput?.write(data);
  } catch {
    consoleOutput = undefined;
  }
}
const target = installedTarget(root);
assertTarget(hostTarget(), target);
const layout = await readInstallLayout(configDir, root);
const files = new ReleaseFiles(layout.versionsDir, layout.tmpDir, target);
const unlock = await acquireLock(join(layout.versionsDir, "launcher.lock"));
const log = new RotatingLog(join(layout.logsDir, "launcher.log"));
const report = (text: string): Promise<void> => {
  echo(text);
  return log.write(text);
};
const supervisor = new Supervisor({
  now: Date.now,
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  read: () => files.read(),
  save: (s) => files.save(s),
  incident: (s) => report(`${new Date().toISOString()} ${s}\n`),
  prune: (keep) => files.prune(keep),
  restore: async (backup, previous) => {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          join(files.version(previous), "server.js"),
          "restore",
          backup,
          configDir,
        ],
        {
          cwd: root,
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
    const release = files.version(build);
    const manifest = JSON.parse(
      await readFile(join(release, "release.json"), "utf8"),
    ) as { platform: string };
    assertTarget(manifest.platform, target);
    const state = await files.read();
    const child = fork(join(release, "server.js"), [], {
      cwd: root,
      execArgv: [],
      silent: true,
    });
    sendStart(child, {
      configDir,
      assetsDir: join(release, "client"),
      workerFile: join(release, "shell", "sw.js"),
      launcher: { target, updatePending: !!state.pending },
    });
    const stdout = new ChildLogOutput((line) => {
      void log.write(line);
    });
    const stderr = new ChildLogOutput((line) => {
      void log.write(line);
    });
    child.stdout?.on("data", (data: Buffer) => {
      echo(data);
      stdout.push(data);
    });
    child.stdout?.on("end", () => stdout.end());
    child.stderr?.on("data", (data: Buffer) => {
      echo(data);
      stderr.push(data);
    });
    child.stderr?.on("end", () => stderr.end());
    child.on("error", (error) => {
      void report(`${String(error)}\n`);
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
          void report(`${String(error)}\n`);
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
  await report(`${String(error)}\n`);
  await supervisor.stop();
  await unlock();
  process.exitCode = 1;
}
