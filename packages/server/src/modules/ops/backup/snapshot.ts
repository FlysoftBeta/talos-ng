import { AppError } from "@talos/base";
import { ledgerInventory } from "../../../kernel/objects/inventory.ts";
import { Db } from "../../../kernel/persistence/db.ts";

/** The sole whole-database backup gateway. Live access can only create a snapshot;
 * opened snapshots expose bounded, read-only inventory and integrity queries. */
export class BackupSnapshots {
  constructor(private readonly source: Pick<Db, "backupTo">) {}
  capture(path: string): Promise<void> {
    return this.source.backupTo(path);
  }
}
export class BackupSnapshot {
  private readonly db: Db;
  constructor(path: string) {
    this.db = new Db(path, 5000, true);
  }
  *objects(): Iterable<{ id: string; size: number }> {
    yield* ledgerInventory(this.db);
  }
  validate(): void {
    if (
      this.db.get<{ integrity_check: string }>("PRAGMA integrity_check")
        ?.integrity_check !== "ok" ||
      this.db.all("PRAGMA foreign_key_check").length
    )
      throw new AppError("E_INTEGRITY", "备份数据库损坏");
  }
  close(): void {
    this.db.close();
  }
}
