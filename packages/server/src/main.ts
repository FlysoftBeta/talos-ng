import { AppError } from "@talos/base";
import type { ModelProvider } from "./modules/ai/index.ts";
import { ResponsesProvider } from "./modules/ai/index.ts";
import { existsSync, watchFile, unwatchFile } from "node:fs";
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
import { availableParallelism } from "node:os";
import { startSyncReplicas } from "./app/sync-replica.ts";
import type { SyncReplicas } from "./app/sync-replica.ts";
import type { ReplicaStatus } from "./kernel/persistence/replica-pool.ts";
import type { SyncRequest } from "./kernel/sync/sync-hub.ts";
import type { HttpGateway } from "./kernel/transport/httpGateway.ts";
export interface RunningServer {
  readonly kernel: Kernel;
  readonly addresses: HttpGateway["addresses"];
  /** Sync replica pool status; null when pulls run on the main thread. */
  replicas(): ReplicaStatus | null;
  close(): Promise<void>;
}
export async function startServer(
  input: ServerConfig,
  options: {
    printRootPin?: (pin: string) => void;
    ops?: OpsOptions;
    aiProvider?: ModelProvider;
    /** Sync replica workers; default derives from the CPU count (tests pin it). */
    readers?: number;
    /**
     * Module that runs a sync replica when loaded in a worker (the server
     * entry). Without it, every pull is computed on the main thread.
     */
    replicaEntry?: string | URL;
  } = {},
): Promise<RunningServer> {
  const config = parseConfig(input);
  const layout = dataLayout(config.dataDir);
  await Promise.all(
    [layout.root, layout.backups, config.logsDir, config.tmpDir].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  );
  const unlock = await acquireLock(layout.lock, true);
  const log = new Logger({ directory: config.logsDir, build: "dev" });
  let db: Db;
  try {
    db = new Db(layout.db);
  } catch (error) {
    await unlock();
    throw error;
  }
  let replicas: SyncReplicas | undefined;
  const readers =
    options.readers ?? Math.min(4, Math.max(0, availableParallelism() - 1));
  const store = createFsObjectStore({ root: layout.root });
  let kernel: Kernel | undefined;
  let gateway: HttpGateway | undefined;
  let certificate: X509Certificate | undefined;
  const watched: string[] = [];
  let reload = Promise.resolve();
  try {
    const assets = await loadHttpAssets(
      config.assetsDir,
      "dev",
      config.workerFile,
    );
    log.setBuild(assets.manifest.build);
    if (config.https)
      certificate = new X509Certificate(await readFile(config.https.cert));
    let aiProvider = options.aiProvider;
    if (config.modelFile && existsSync(config.modelFile)) {
      try {
        aiProvider = new ResponsesProvider(
          JSON.parse(await readFile(config.modelFile, "utf8")) as unknown,
        );
      } catch (error) {
        throw AppError.wrap(
          "E_INVALID",
          `无法读取 AI 模型配置 ${config.modelFile}`,
          error,
        );
      }
    }
    // A release ships yt-dlp and its plugin next to server.js; in a checkout the
    // dev parent supplies both.
    const releaseMedia = join(import.meta.dirname, "vendor", "media");
    const releasePlugins = join(releaseMedia, "plugins");
    const releaseBinary = join(
      releaseMedia,
      process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp",
    );
    const mediaPluginDir =
      config.pluginDir ??
      (existsSync(releasePlugins) ? releasePlugins : undefined);
    const mediaBinaryPath =
      config.ytDlp ?? (existsSync(releaseBinary) ? releaseBinary : undefined);
    kernel = createKernel({
      aiProvider,
      ops: {
        ...options.ops,
        dataDir: layout.root,
        tmpDir: config.tmpDir,
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
      ...(options.replicaEntry && readers > 0
        ? {
            syncReplicas: (user: string, request: SyncRequest) =>
              replicas
                ? replicas.compute(user, request)
                : Promise.resolve(kernel!.syncHub.snapshot(user, request)),
          }
        : {}),
      build: assets.manifest.build,
      tmpDir: config.tmpDir,
      serverLogs: () => log.snapshot(),
      dev: config.dev,
      testSeed: config.testSeed,
      mediaBinaryPath,
      ...(mediaPluginDir ? { mediaPluginDir } : {}),
      printRootPin:
        options.printRootPin ?? (config.printRootPin ? undefined : () => {}),
    });
    await kernel.chat.ready;
    const ready = kernel;
    if (options.replicaEntry && readers > 0) {
      // Replicas open the database only after the writer migrated and seeded it.
      replicas = startSyncReplicas({
        entry: options.replicaEntry,
        size: readers,
        db: layout.db,
        root: layout.root,
        build: assets.manifest.build,
        local: () => ready.syncHub,
        reportError: (error) => ready.incidents.report(error),
      });
    }
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
        await replicas?.pool.close();
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
    replicas: () => replicas?.pool.status() ?? null,
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
              // Replicas hold WAL snapshots; close them before the checkpoint.
              await replicas?.pool.close();
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
