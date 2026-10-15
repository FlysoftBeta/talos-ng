import { createRequire } from "node:module";
import type * as SQLiteDriver from "node:sqlite";
import type {
  DatabaseSync,
  SQLInputValue,
  StatementResultingChanges,
  StatementSync,
} from "node:sqlite";
import { AppError } from "@talos/base";

// node:sqlite emits synchronously while loading. Restore immediately; no other
// warning category or later warning is suppressed.
function sqlite(): typeof SQLiteDriver {
  const emit = process.emitWarning;
  process.emitWarning = ((...args: Parameters<typeof process.emitWarning>) => {
    if (
      typeof args[0] === "string" &&
      args[0].startsWith("SQLite is an experimental feature") &&
      (args[1] as unknown) === "ExperimentalWarning"
    )
      return;
    Reflect.apply(emit, process, args);
  }) as typeof process.emitWarning;
  try {
    return createRequire(import.meta.url)("node:sqlite") as typeof SQLiteDriver;
  } finally {
    process.emitWarning = emit;
  }
}
const driver = sqlite();

export class Db {
  private readonly database: DatabaseSync;
  private readonly cache = new Map<string, StatementSync>();
  private depth = 0;
  private closed = false;
  constructor(
    path = ":memory:",
    busyTimeoutMs = 5000,
    private readonly readOnly = false,
  ) {
    if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0)
      throw new AppError("E_INVALID", "数据库等待时间无效");
    this.database = new driver.DatabaseSync(path, { readOnly });
    this.database.exec(
      readOnly
        ? `PRAGMA foreign_keys=ON; PRAGMA busy_timeout=${busyTimeoutMs};`
        : `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=${busyTimeoutMs}; PRAGMA synchronous=NORMAL;`,
    );
  }
  get inTransaction(): boolean {
    return this.depth > 0;
  }
  prepare(sql: string): StatementSync {
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
  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.prepare(sql).get(...params) as T | undefined;
  }
  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.prepare(sql).all(...params) as T[];
  }
  run(sql: string, ...params: SQLInputValue[]): StatementResultingChanges {
    return this.prepare(sql).run(...params);
  }
  tx<T>(fn: () => T): T {
    const depth = this.depth++;
    const savepoint = `talos_${depth}`;
    try {
      this.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
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
  async backupTo(path: string): Promise<void> {
    if (this.inTransaction) throw new AppError("E_CONFLICT", "事务中不能备份");
    await driver.backup(this.database, path);
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
