import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseStartMessage, serverWiringSchema } from "@talos/launcher";
import type { ServerWiring } from "@talos/launcher";
import { loadSettings, parseConfig, startServer } from "../src/index.ts";
import type { RunningServer } from "../src/index.ts";
import { restoreBackup } from "../src/modules/ops/index.ts";
import type { ModelProvider } from "../src/modules/ai/index.ts";

/** The repository root, for runs that no launcher or dev script hosts. */
function checkoutRoot(): string {
  const root = resolve(import.meta.dirname, "..", "..", "..");
  if (!existsSync(join(root, "pnpm-workspace.yaml")))
    throw new Error("请通过启动器运行服务器");
  return root;
}

/**
 * A parent process sends the wiring as its first IPC message. The listener
 * stays attached afterwards: it routes the launcher's control messages.
 */
function receiveWiring(control: (type: string) => void): Promise<ServerWiring> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("父进程未发送启动消息")),
      30_000,
    );
    let started = false;
    process.on("message", (message: unknown) => {
      if (started) {
        control((message as { type?: string } | null)?.type ?? "");
        return;
      }
      started = true;
      clearTimeout(timer);
      try {
        resolve(parseStartMessage(message));
      } catch (error) {
        reject(error as Error);
      }
    });
  });
}

/** The same wiring, built in-process for `node bin/talos-server.ts [--dev]` in a checkout. */
function checkoutWiring(): ServerWiring {
  const root = checkoutRoot();
  return serverWiringSchema.parse({
    dataDir: join(root, ".data"),
    settingsFile: join(root, "talos.config.json"),
    assetsDir: join(root, "packages", "client", "dist"),
    workerFile: join(root, "packages", "shell", "dist", "sw.js"),
    dev: process.argv.includes("--dev"),
    pluginDir: join(root, "packages", "server", "ytdlp-plugin"),
  });
}

export async function runServer(
  aiProvider?: ModelProvider,
  /** This process's entry module; replica workers load it again. */
  replicaEntry?: string,
): Promise<void> {
  if (process.argv[2] === "restore") {
    // `restore <backup> [dataDir]`: offline, run by the launcher on rollback.
    const [, , , backup, dataDir] = process.argv;
    if (!backup)
      throw new Error("用法：talos-server restore <备份> [数据目录]");
    await restoreBackup(backup, dataDir ?? checkoutWiring().dataDir);
    process.stdout.write("备份已恢复\n");
    return;
  }
  let server: RunningServer | undefined;
  let stopping = false;
  const stop = () => {
    stopping = true;
    if (!server) return;
    const closing = server;
    server = undefined;
    void closing
      .close()
      .then(() => {
        if (process.connected) process.disconnect();
      })
      .catch(() => {
        process.exitCode = 1;
        if (process.connected) process.disconnect();
      });
  };
  const { settingsFile, ...wiring } = process.send
    ? await receiveWiring((type) => {
        if (type === "update-failed")
          server?.kernel.ops.updates.reject("更新无法应用，请查看启动器日志");
        if (type === "shutdown") stop();
      })
    : checkoutWiring();
  const config = parseConfig({
    ...(await loadSettings(settingsFile)),
    ...wiring,
  });
  const launcher = wiring.launcher;
  const running = await startServer(config, {
    aiProvider,
    replicaEntry,
    ops: {
      bridge: launcher
        ? {
            pending: launcher.updatePending,
            root: launcher.root,
            confirm: () => {
              process.send?.({ type: "confirmed" });
            },
            apply: (message) => {
              process.send?.({ type: "apply", ...message });
            },
          }
        : undefined,
    },
  });
  server = running;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.once(signal, stop);
  if (stopping) stop();
}
