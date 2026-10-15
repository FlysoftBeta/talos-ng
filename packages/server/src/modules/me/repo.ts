import { AppError } from "@talos/base";
import type { JsonValue } from "@talos/contract";
import type { Lww, Row } from "@talos/sync";
import type { Db } from "../../kernel/persistence/db.ts";
export interface Setting {
  id: string;
  key: string;
  value: Lww<JsonValue>;
}
interface SettingRecord {
  key: string;
  value: string;
  rev: number;
  deleted: number;
}
export class MeRepo {
  constructor(private readonly db: Db) {}
  get(user: string, key: string): Setting | undefined {
    const record = this.db.get<SettingRecord>(
      "SELECT * FROM me_settings WHERE user_id=? AND key=?",
      user,
      key,
    );
    return record && !record.deleted ? this.data(record) : undefined;
  }
  put(user: string, key: string, value: Lww<JsonValue>, rev: number): void {
    this.db.run(
      "INSERT INTO me_settings(user_id,key,value,rev) VALUES(?,?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value,rev=excluded.rev,deleted=0",
      user,
      key,
      JSON.stringify(value),
      rev,
    );
  }
  select(user: string, since: number, limit: number): Row[] {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new AppError("E_INVALID", "设置查询数量无效");
    return this.db
      .all<SettingRecord>(
        "SELECT * FROM me_settings WHERE user_id=? AND rev>? ORDER BY rev,key LIMIT ?",
        user,
        since,
        limit,
      )
      .map((row) => this.row(row));
  }
  read(user: string, key: string): Row | undefined {
    const row = this.db.get<SettingRecord>(
      "SELECT * FROM me_settings WHERE user_id=? AND key=?",
      user,
      key,
    );
    return row ? this.row(row) : undefined;
  }
  private data(row: SettingRecord): Setting {
    return {
      id: row.key,
      key: row.key,
      value: JSON.parse(row.value) as Lww<JsonValue>,
    };
  }
  private row(row: SettingRecord): Row {
    return {
      type: "setting",
      id: row.key,
      rev: row.rev,
      deleted: row.deleted === 1,
      data: row.deleted ? null : this.data(row),
    };
  }
}
