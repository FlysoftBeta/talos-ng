import Database from "better-sqlite3";
import type { Database as Driver, RunResult, Statement } from "better-sqlite3";
import { performance } from "node:perf_hooks";
import { AppError } from "@talos/base";
import { normalizeSql } from "./query-stats.ts";
import type { QuerySource, QueryStats } from "./query-stats.ts";

/** Values SQLite binds natively (the adapter never relies on implicit coercion). */
export type SqlValue = null | number | bigint | string | Uint8Array;

export class Db {
  private readonly database: Driver;
  private readonly cache = new Map<string, Statement>();
  private readonly shapes = new Map<string, string>();
  private depth = 0;
  private closed = false;
  private stats: QueryStats | undefined;
  private source: QuerySource = "writer";
  private txStarted = 0;
  private txShape: string | undefined;
  constructor(
    path = ":memory:",
    busyTimeoutMs = 5000,
    private readonly readOnly = false,
  ) {
    if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0)
      throw new AppError("E_INVALID", "数据库等待时间无效");
    // `timeout` is SQLite's busy_timeout.
    this.database = new Database(path, {
      readonly: readOnly,
      timeout: busyTimeoutMs,
    });
    this.database.exec(
      readOnly
        ? "PRAGMA foreign_keys=ON;"
        : "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;",
    );
  }
  /** Time every statement and outer transaction into `stats` (undefined stops). */
  observe(stats: QueryStats | undefined, source: QuerySource = "writer"): void {
    this.stats = stats;
    this.source = source;
  }
  get inTransaction(): boolean {
    return this.depth > 0;
  }
  prepare(sql: string): Statement {
    let statement = this.cache.get(sql);
    if (!statement) {
      statement = this.database.prepare(sql);
      this.cache.set(sql, statement);
    }
    return statement;
  }
  exec(sql: string): void {
    if (!this.stats) {
      this.database.exec(sql);
      return;
    }
    const started = performance.now();
    try {
      this.database.exec(sql);
    } finally {
      this.timed(sql, started);
    }
  }
  get<T>(sql: string, ...params: SqlValue[]): T | undefined {
    const statement = this.prepare(sql);
    if (!this.stats) return statement.get(...params) as T | undefined;
    const started = performance.now();
    try {
      return statement.get(...params) as T | undefined;
    } finally {
      this.timed(sql, started);
    }
  }
  all<T>(sql: string, ...params: SqlValue[]): T[] {
    const statement = this.prepare(sql);
    if (!this.stats) return statement.all(...params) as T[];
    const started = performance.now();
    try {
      return statement.all(...params) as T[];
    } finally {
      this.timed(sql, started);
    }
  }
  run(sql: string, ...params: SqlValue[]): RunResult {
    const statement = this.prepare(sql);
    if (!this.stats) return statement.run(...params);
    const started = performance.now();
    try {
      return statement.run(...params);
    } finally {
      this.timed(sql, started);
    }
  }
  private shape(sql: string): string {
    let shape = this.shapes.get(sql);
    if (shape === undefined) {
      shape = normalizeSql(sql);
      if (this.shapes.size < 4096) this.shapes.set(sql, shape);
    }
    return shape;
  }
  private timed(sql: string, started: number): void {
    const stats = this.stats;
    if (!stats) return;
    stats.record(
      this.source,
      "statement",
      this.shape(sql),
      performance.now() - started,
    );
  }
  /** `label` names the outer transaction in statistics (default: its call site). */
  tx<T>(fn: () => T, label?: string): T {
    const depth = this.depth++;
    const savepoint = `talos_${depth}`;
    if (depth === 0) {
      this.txStarted = performance.now();
      this.txShape = this.stats ? (label ?? transactionSite()) : undefined;
    }
    try {
      // A read-only replica has no write lock to take; its transactions are
      // snapshots and any write inside them fails.
      this.database.exec(
        depth > 0
          ? `SAVEPOINT ${savepoint}`
          : this.readOnly
            ? "BEGIN"
            : "BEGIN IMMEDIATE",
      );
    } catch (error) {
      this.depth--;
      throw error;
    }
    try {
      const result = fn();
      if (result && typeof (result as { then?: unknown }).then === "function")
        throw new AppError("E_INVALID", "事务回调必须同步");
      this.database.exec(depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      this.database.exec(
        depth === 0
          ? "ROLLBACK"
          : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`,
      );
      throw error;
    } finally {
      this.depth--;
      // The whole outer transaction holds the writer and the event loop; it is
      // labelled by its call site so slow units of work can be traced.
      if (depth === 0 && this.stats)
        this.stats.record(
          this.source,
          "transaction",
          this.txShape ?? "transaction",
          performance.now() - this.txStarted,
        );
    }
  }
  get isReadOnly(): boolean {
    return this.readOnly;
  }
  /** Run reads against one consistent WAL snapshot (a deferred read transaction). */
  snapshot<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    this.txStarted = performance.now();
    this.txShape = this.stats ? transactionSite() : undefined;
    try {
      this.database.exec("BEGIN");
      try {
        const result = fn();
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    } finally {
      this.depth--;
      if (this.stats)
        this.stats.record(
          this.source,
          "transaction",
          this.txShape ?? "transaction",
          performance.now() - this.txStarted,
        );
    }
  }
  async backupTo(path: string): Promise<void> {
    if (this.inTransaction) throw new AppError("E_CONFLICT", "事务中不能备份");
    await this.database.backup(path);
  }
  checkpoint(): void {
    this.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
  close(): void {
    if (this.closed) return;
    if (!this.readOnly) this.checkpoint();
    this.cache.clear();
    this.database.close();
    this.closed = true;
  }
}

/**
 * First caller outside Db/Uow, e.g. `Posts.send @ modules/chat/posts/service.ts:42`
 * (`server.js:<line>` in the bundled server, where the function name carries it).
 */
function transactionSite(): string {
  const holder: { stack?: string } = {};
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 12;
  Error.captureStackTrace(holder, transactionSite);
  Error.stackTraceLimit = limit;
  for (const line of (holder.stack ?? "").split("\n").slice(1)) {
    // Source paths in development, class names in the bundled server.
    if (
      /[\\/]kernel[\\/]persistence[\\/](?:db|uow)\.ts:/.test(line) ||
      /\bat (?:new )?(?:Db|Uow)\./.test(line)
    )
      continue;
    const site = /([^\s(]+):(\d+):\d+\)?$/.exec(line.trim());
    if (!site) continue;
    const path = site[1]!.replace(/\\/g, "/");
    const source = /\/src\/(.*)$/.exec(path)?.[1] ?? path.split("/").pop()!;
    const name = /^at (?:async )?([^\s(]+) \(/.exec(line.trim())?.[1];
    return `${name && name !== "<anonymous>" ? name : "transaction"} @ ${source}:${site[2]}`;
  }
  return "transaction";
}

export interface Migration {
  readonly n: number;
  readonly up: (db: Db) => void;
}
export function migrate(
  db: Db,
  module: string,
  migrations: readonly Migration[],
  now: () => number = Date.now,
): void {
  if (db.isReadOnly) {
    // Replicas never migrate: the writer has already brought the schema current.
    const applied = db.get<{ n: number }>(
      "SELECT count(*) AS n FROM _migrations WHERE module=?",
      module,
    );
    if (applied?.n !== migrations.length)
      throw new AppError("E_VERSION", "数据库迁移版本不兼容");
    return;
  }
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations(module TEXT NOT NULL,n INTEGER NOT NULL,applied_at INTEGER NOT NULL,PRIMARY KEY(module,n)) STRICT",
  );
  const applied = db.all<{ n: number }>(
    "SELECT n FROM _migrations WHERE module=? ORDER BY n",
    module,
  );
  if (
    migrations.some((m, i) => m.n !== i + 1) ||
    applied.some((m, i) => m.n !== migrations[i]?.n)
  )
    throw new AppError("E_VERSION", "数据库迁移版本不兼容");
  if (applied.length === migrations.length) return;
  db.tx(() => {
    for (const migration of migrations.slice(applied.length)) {
      migration.up(db);
      db.run(
        "INSERT INTO _migrations VALUES(?,?,?)",
        module,
        migration.n,
        now(),
      );
    }
  });
}
