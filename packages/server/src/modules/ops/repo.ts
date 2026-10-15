import type { ResultOf } from "@talos/contract";
import { contract } from "@talos/contract";
import type { Db } from "../../kernel/persistence/db.ts";
import { migrate } from "../../kernel/persistence/db.ts";
import { opsMigrations } from "./schema.ts";
export type OpsSettings = ResultOf<typeof contract.ops.settings.get>;
export type BackupRow = ResultOf<typeof contract.ops.backup.list>[number];
export type OfficeRow = ResultOf<
  typeof contract.ops.office.list
>["files"][number];
export class OpsRepo {
  constructor(
    private readonly db: Db,
    now: () => number,
  ) {
    migrate(db, "operations", opsMigrations, now);
  }
  addDownload(
    objectId: string,
    user: string,
    expires: number,
    backup: string,
  ): void {
    this.db.run(
      "INSERT OR REPLACE INTO ops_downloads VALUES(?,?,?,?)",
      objectId,
      user,
      expires,
      backup,
    );
  }
  expiredDownloads(now: number): { object_id: string }[] {
    return this.db.all(
      "SELECT DISTINCT object_id FROM ops_downloads WHERE expires<=?",
      now,
    );
  }
  activeDownload(objectId: string, now: number): boolean {
    return !!this.db.get(
      "SELECT 1 FROM ops_downloads WHERE object_id=? AND expires>?",
      objectId,
      now,
    );
  }
  clearExpiredDownloads(now: number): void {
    this.db.run("DELETE FROM ops_downloads WHERE expires<=?", now);
  }
  deleteBackupDownloads(id: string): void {
    this.db.run("DELETE FROM ops_downloads WHERE backup_id=?", id);
  }
  settings(): OpsSettings {
    return contract.ops.settings.get.result.parse(
      JSON.parse(
        this.db.get<{ value: string }>(
          "SELECT value FROM ops_settings WHERE id=1",
        )!.value,
      ),
    );
  }
  saveSettings(value: OpsSettings): OpsSettings {
    this.db.run(
      "UPDATE ops_settings SET value=? WHERE id=1",
      JSON.stringify(value),
    );
    return value;
  }
  backups(): BackupRow[] {
    return this.db.all(
      "SELECT * FROM ops_backups ORDER BY created DESC,id DESC",
    );
  }
  addBackup(row: BackupRow): void {
    this.db.run(
      "INSERT INTO ops_backups VALUES(?,?,?)",
      row.id,
      row.created,
      row.size,
    );
  }
  deleteBackup(id: string): void {
    this.db.run("UPDATE ops_downloads SET expires=0 WHERE backup_id=?", id);
    this.db.run("DELETE FROM ops_backups WHERE id=?", id);
  }
  office(): OfficeRow[] {
    return this.db.all(
      "SELECT id,name,application,kind,object_id AS objectId,size,created FROM ops_office ORDER BY created DESC,id DESC",
    );
  }
  addOffice(row: OfficeRow): void {
    this.db.run(
      "INSERT INTO ops_office VALUES(?,?,?,?,?,?,?)",
      row.id,
      row.name,
      row.application,
      row.kind,
      row.objectId,
      row.size,
      row.created,
    );
  }
  clearOffice(): void {
    this.db.run("DELETE FROM ops_office");
  }
}
