import { AppError } from "@talos/base";
import type { ModelProvider } from "./modules/ai/index.ts";
import { ResponsesProvider } from "./modules/ai/index.ts";
import { watchFile, unwatchFile } from "node:fs";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import { acquireLock } from "@talos/launcher";
import type { OpsOptions } from "./modules/ops/index.ts";
import { mkdir, readFile } from "node:fs/promises";
import { createFsObjectStore } from "@talos/objectstore";
import { loadHttpAssets } from "./kernel/transport/http-assets.ts";
import { Db } from "./kernel/persistence/db.ts";
import { dataLayout, parseConfig } from "./kernel/config/config.ts";
import type { ServerConfig } from "./kernel/config/config.ts";
import { createKernel } from "./app/create-application.ts";
import type { Kernel } from "./app/create-application.ts";
import { Logger } from "./kernel/diagnostics/log.ts";
import { startHttpGateway } from "./kernel/transport/httpGateway.ts";
import type { HttpGateway } from "./kernel/transport/httpGateway.ts";
export interface RunningServer {
  readonly kernel: Kernel;
  readonly addresses: HttpGateway["addresses"];
  close(): Promise<void>;
}
export async function startServer(
  input: ServerConfig,
  options: {
    printRootPin?: (pin: string) => void;
    ops?: OpsOptions;
    aiProvider?: ModelProvider;
  } = {},
): Promise<RunningServer> {
  const config = parseConfig(input);
  const layout = dataLayout(config.dataDir);
  await Promise.all(
    [layout.root, layout.logs, layout.backups].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  );
  const unlock = await acquireLock(layout.root, true);
  const log = new Logger({ directory: layout.logs, build: config.build });
  let db: Db;
  try {
    db = new Db(layout.db);
  } catch (error) {
    await unlock();
    throw error;
  }
  const store = createFsObjectStore({ root: layout.root });
  let kernel: Kernel | undefined;
  let gateway: HttpGateway | undefined;
  let certificate: X509Certificate | undefined;
  const watched: string[] = [];
  let reload = Promise.resolve();
  try {
    const assets = await loadHttpAssets(
      config.assetsDir,
      config.build,
      config.workerFile,
    );
    log.setBuild(assets.manifest.build);
    if (config.https)
      certificate = new X509Certificate(await readFile(config.https.cert));
    let aiProvider = options.aiProvider;
    if (config.aiModelsFile) {
      try {
        aiProvider = new ResponsesProvider(
          JSON.parse(await readFile(config.aiModelsFile, "utf8")) as unknown,
        );
      } catch {
        throw new AppError("E_INVALID", "无法读取 AI 模型配置");
      }
    }
    kernel = createKernel({
      aiProvider,
      ops: {
        ...options.ops,
        dataDir: layout.root,
        httpsStatus: () => ({
          domain: config.https?.domain ?? null,
          listeners: [...(gateway?.addresses ?? [])],
          expiry: certificate ? Date.parse(certificate.validTo) : null,
          redirect: config.https?.redirect ?? false,
          ca: !!config.https?.ca,
        }),
      },
      db,
      store,
      build: assets.manifest.build,
      serverLogs: () => log.snapshot(),
      dev: config.dev,
      testSeed: config.testSeed,
      mediaBinaryPath:
        config.binaries["yt-dlp"] ??
        join(
          import.meta.dirname,
          "vendor",
          "media",
          process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp",
        ),
      printRootPin: options.printRootPin,
    });
    await kernel.chat.ready;
    const ready = kernel;
    gateway = await startHttpGateway({
      ports: config.ports,
      securePorts: config.securePorts,
      bindHost: config.bindHost,
      assets,
      build: assets.manifest.build,
      store,
      tickets: ready.tickets,
      ...(config.https
        ? {
            tls: {
              cert: await readFile(config.https.cert),
              key: await readFile(config.https.key),
            },
            ca: config.https.ca ? await readFile(config.https.ca) : undefined,
          }
        : {}),
      ...(config.https?.redirect
        ? {
            redirect: {
              domain: config.https.domain!,
              port: config.securePorts[0],
            },
          }
        : {}),
      onConnection: (carrier, info) => {
        ready.host.link.accept(carrier, info);
      },
      reportError: (error) => {
        ready.incidents.report(error);
      },
    });
    if (config.https) {
      const https = config.https;
      const changed = () => {
        reload = reload
          .then(async () => {
            const cert = await readFile(https.cert),
              key = await readFile(https.key);
            const next = new X509Certificate(cert);
            gateway!.reloadTls(
              { cert, key },
              https.ca ? await readFile(https.ca) : undefined,
            );
            certificate = next;
          })
          .catch((error) => {
            ready.incidents.report(error);
          });
      };
      for (const path of [
        https.cert,
        https.key,
        ...(https.ca ? [https.ca] : []),
      ]) {
        watchFile(path, { interval: 1000, persistent: false }, changed);
        watched.push(path);
      }
    }
    log.write("info", "服务器已启动", {
      build: assets.manifest.build,
      addresses: gateway.addresses,
    });
  } catch (error) {
    try {
      await kernel?.close();
    } finally {
      try {
        await gateway?.close();
      } finally {
        db.close();
        await unlock();
      }
    }
    throw error;
  }
  const ready = kernel;
  const http = gateway;
  let maintenanceTimer: ReturnType<typeof setTimeout> | undefined;
  let stopping = false;
  const schedule = () => {
    maintenanceTimer = setTimeout(() => {
      void ready
        .maintain()
        .catch((error) => {
          ready.incidents.report(error);
        })
        .finally(() => {
          if (!stopping) schedule();
        });
    }, 60_000);
    maintenanceTimer.unref();
  };
  schedule();
  let closing: Promise<void> | undefined;
  return {
    kernel: ready,
    addresses: http.addresses,
    close(): Promise<void> {
      if (!closing)
        closing = (async () => {
          stopping = true;
          for (const path of watched) unwatchFile(path);
          await reload;
          clearTimeout(maintenanceTimer);
          http.stopAccepting();
          try {
            await ready.close();
          } finally {
            try {
              await http.close();
            } finally {
              db.close();
              await unlock();
            }
          }
          log.write("info", "服务器已关闭");
        })();
      return closing;
    },
  };
}
