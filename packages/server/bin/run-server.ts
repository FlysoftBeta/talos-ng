import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  configDirectory,
  parseStartMessage,
  readInstallLayout,
  serverWiringSchema,
} from "@talos/launcher";
import type { ServerWiring } from "@talos/launcher";
import { serverConfig, startServer } from "../src/index.ts";
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

/** The first argument that is not a flag: the config directory. */
function configArgument(): string | undefined {
  return process.argv.slice(2).find((arg) => !arg.startsWith("--"));
}

/**
 * The same wiring, built in-process for `node bin/talos-server.ts
 * [config-dir] [--dev]` in a checkout; like an install, the working
 * directory is the root.
 */
function checkoutWiring(): ServerWiring {
  const root = checkoutRoot();
  return serverWiringSchema.parse({
    configDir: configDirectory(configArgument()),
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
    // `restore <backup> [config-dir]` from the install root: offline, run by
    // the launcher on rollback and by operators.
    const [, , , backup, configDir] = process.argv;
    if (!backup)
      throw new Error("用法：talos-server restore <备份> [配置目录]");
    const layout = await readInstallLayout(configDirectory(configDir));
    await restoreBackup(resolve(backup), layout.dataDir);
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
  const { configDir, ...wiring } = process.send
    ? await receiveWiring((type) => {
        if (type === "update-failed")
          server?.kernel.ops.updates.reject("更新无法应用，请查看启动器日志");
        if (type === "shutdown") stop();
      })
    : checkoutWiring();
  const config = await serverConfig(await readInstallLayout(configDir), wiring);
  const launcher = wiring.launcher;
  const running = await startServer(config, {
    aiProvider,
    replicaEntry,
    ops: {
      bridge: launcher
        ? {
            pending: launcher.updatePending,
            target: launcher.target,
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
