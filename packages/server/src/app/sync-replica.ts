import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { isMainThread, workerData } from "node:worker_threads";
import { AppError } from "@talos/base";
import { createFsObjectStore } from "@talos/objectstore";
import { Db } from "../kernel/persistence/db.ts";
import { QueryStats } from "../kernel/persistence/query-stats.ts";
import { ReplicaPool } from "../kernel/persistence/replica-pool.ts";
import { serveReplica } from "../kernel/persistence/replica-worker.ts";
import type {
  SyncHub,
  SyncRequest,
  SyncSnapshot,
} from "../kernel/sync/sync-hub.ts";
import { createKernel } from "./create-application.ts";

/**
 * Sync pulls are the dominant read: every connect pages every scope of the
 * user. Replica workers build the same module graph over a read-only
 * connection, so pages come from the exact providers and serialisers the
 * writer registers, and only subscription bookkeeping stays on the main thread.
 */
const ROLE = "talos.sync-replica";
const SNAPSHOT = "sync.snapshot";

export interface SyncReplicaData {
  role: typeof ROLE;
  db: string;
  root: string;
  build: string;
  slowMs: number;
}

/** True inside a replica worker started by `startSyncReplicas`. */
export function isSyncReplica(): boolean {
  return (
    !isMainThread &&
    (workerData as Partial<SyncReplicaData> | null)?.role === ROLE
  );
}

/** Worker entry: build the read-only module graph and answer snapshot tasks. */
export function runSyncReplica(): void {
  const data = workerData as SyncReplicaData;
  const stats = new QueryStats({ slowMs: data.slowMs });
  const db = new Db(data.db, 5000, true);
  db.observe(stats, "reader");
  const kernel = createKernel({
    db,
    store: createFsObjectStore({ root: data.root }),
    build: data.build,
    backgroundTasks: false,
    replica: true,
  });
  serveReplica(db, stats, {
    [SNAPSHOT]: (input) => {
      const { user, request } = input as { user: string; request: SyncRequest };
      return kernel.syncHub.snapshot(user, request);
    },
  });
}

export interface SyncReplicas {
  readonly pool: ReplicaPool;
  compute(user: string, request: SyncRequest): Promise<SyncSnapshot>;
}

export function startSyncReplicas(options: {
  /** Module whose top level calls `runSyncReplica` when `isSyncReplica()`. */
  entry: string | URL;
  size: number;
  db: string;
  root: string;
  build: string;
  slowMs: number;
  /** Computes locally while no replica is available. */
  local: () => SyncHub;
  reportError?(error: unknown): void;
}): SyncReplicas {
  const entry = String(options.entry);
  const pool = new ReplicaPool({
    // Development entries are TypeScript; workers do not inherit the tsx
    // loader hooks, so a bootstrap registers them before importing the entry.
    ...(entry.endsWith(".ts")
      ? { entry: typescriptBootstrap(entry), evalEntry: true }
      : // Worker treats a plain string as a path; file: URLs must be URL objects.
        { entry: entry.startsWith("file:") ? new URL(entry) : options.entry }),
    size: options.size,
    workerData: {
      role: ROLE,
      db: options.db,
      root: options.root,
      build: options.build,
      slowMs: options.slowMs,
    } satisfies SyncReplicaData,
    reportError: options.reportError,
  });
  return {
    pool,
    compute: async (user, request) => {
      try {
        return await pool.run<SyncSnapshot>(SNAPSHOT, { user, request });
      } catch (error) {
        if (
          error instanceof AppError &&
          (error.code === "E_UNAVAILABLE" || error.code === "E_TIMEOUT")
        )
          return options.local().snapshot(user, request);
        throw error;
      }
    },
  };
}

function typescriptBootstrap(entry: string): string {
  const loader = pathToFileURL(
    createRequire(import.meta.url)
      .resolve("tsx/esm/api")
      .replace(/\.cjs$/, ".mjs"),
  ).href;
  const module = entry.startsWith("file:") ? entry : pathToFileURL(entry).href;
  return `import(${JSON.stringify(loader)}).then((tsx) => { tsx.register(); return import(${JSON.stringify(module)}); });`;
}
