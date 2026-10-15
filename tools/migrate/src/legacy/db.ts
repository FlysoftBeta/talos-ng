import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import { Db } from "@talos/server/migration";
import { installCompatibility } from "./compat.ts";
import { AppError } from "@talos/base";

import type { LegacyRow } from "../types.ts";

export class LegacyDb {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path, { readOnly: true });
    try {
      installCompatibility(this.db);
      this.db.exec("PRAGMA query_only=ON");
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  schema(): {
    version: string | null;
    tables: Record<string, string[]>;
    compatibilityViews: string[];
  } {
    const tables: Record<string, string[]> = {};
    for (const { name } of this.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )) {
      tables[name] = this.all<{ name: string }>(
        `PRAGMA table_info("${name.replaceAll('"', '""')}")`,
      ).map((c) => c.name);
    }
    return {
      version: tables.config
        ? (this.get<{ value: string }>(
            "SELECT value FROM config WHERE key='schema_version'",
          )?.value ?? null)
        : null,
      tables,
      compatibilityViews: this.all<{ name: string }>(
        "SELECT name FROM sqlite_temp_master WHERE type='view' ORDER BY name",
      ).map((r) => r.name),
    };
  }
  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
  close(): void {
    this.db.close();
  }
}
export function exists(db: Db | LegacyDb, table: string): boolean {
  return !!db.get(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? UNION ALL SELECT 1 FROM sqlite_temp_master WHERE type='view' AND name=?",
    table,
    table,
  );
}
export function readPage(
  db: LegacyDb,
  table: string,
  offset: number,
): LegacyRow[] {
  if (!/^[a-z_]+$/.test(table) || !Number.isSafeInteger(offset) || offset < 0)
    throw new AppError("E_INVALID", "Invalid legacy page");
  return db.all<LegacyRow>(
    `SELECT * FROM "${table}" ORDER BY rowid LIMIT 500 OFFSET ?`,
    offset,
  );
}
export function openSource(path: string): LegacyDb {
  if (!existsSync(path))
    throw new AppError("E_NOT_FOUND", "Legacy data.db does not exist");
  return new LegacyDb(path);
}
