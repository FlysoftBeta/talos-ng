import { loadConfig, startServer } from "../src/index.ts";
import { restoreBackup } from "../src/modules/ops/index.ts";
import type { ModelProvider } from "../src/modules/ai/index.ts";
export async function runServer(aiProvider?: ModelProvider): Promise<void> {
  const config = await loadConfig(undefined, {
    ...process.env,
    ...(process.argv.includes("--dev") ? { TALOS_DEV: "true" } : {}),
  });
  if (process.argv[2] === "restore") {
    if (!process.argv[3])
      throw new Error("用法：talos-server restore <备份.zip>");
    await restoreBackup(process.argv[3], config.dataDir);
    process.stdout.write("备份已恢复\n");
  } else {
    const server = await startServer(config, {
      aiProvider,
      ops: {
        bridge: process.send
          ? {
              pending: process.env.TALOS_UPDATE_PENDING === "true",
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
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void server
        .close()
        .then(() => {
          if (process.connected) process.disconnect();
        })
        .catch(() => {
          process.exitCode = 1;
          if (process.connected) process.disconnect();
        });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    process.once("SIGHUP", stop);
    process.on("message", (message: unknown) => {
      if (
        message &&
        typeof message === "object" &&
        (message as { type?: string }).type === "update-failed"
      )
        server.kernel.ops.updates.reject("更新无法应用，请查看启动器日志");
      if (
        message &&
        typeof message === "object" &&
        (message as { type?: string }).type === "shutdown"
      )
        stop();
    });
  }
}
