import Database from "better-sqlite3";
import type { Database as Driver, RunResult, Statement } from "better-sqlite3";
import { AppError } from "@talos/base";

/** Values SQLite binds natively (the adapter never relies on implicit coercion). */
export type SqlValue = null | number | bigint | string | Uint8Array;

export class Db {
  private readonly database: Driver;
  private readonly cache = new Map<string, Statement>();
  private depth = 0;
  private closed = false;
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
    this.database.exec(sql);
  }
  get<T>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.prepare(sql).get(...params) as T | undefined;
  }
  all<T>(sql: string, ...params: SqlValue[]): T[] {
    return this.prepare(sql).all(...params) as T[];
  }
  run(sql: string, ...params: SqlValue[]): RunResult {
    return this.prepare(sql).run(...params);
  }
  tx<T>(fn: () => T): T {
    const depth = this.depth++;
    const savepoint = `talos_${depth}`;
    try {
      // A read-only replica has no write lock to take; its transactions are
      // snapshots and any write inside them fails.
      this.exec(
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
      this.exec(depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      this.exec(
        depth === 0
          ? "ROLLBACK"
          : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`,
      );
      throw error;
    } finally {
      this.depth--;
    }
  }
  get isReadOnly(): boolean {
    return this.readOnly;
  }
  /** Run reads against one consistent WAL snapshot (a deferred read transaction). */
  snapshot<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    try {
      this.exec("BEGIN");
      try {
        const result = fn();
        this.exec("COMMIT");
        return result;
      } catch (error) {
        this.exec("ROLLBACK");
        throw error;
      }
    } finally {
      this.depth--;
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
