import type { Db } from "../../kernel/persistence/db.ts";
export class AdminRepo {
  constructor(readonly db: Db) {}
  settings(): { maxVolume: number } {
    const row = this.db.get<{ max_volume: number }>(
      "SELECT max_volume FROM admin_settings WHERE id=1",
    )!;
    return { maxVolume: row.max_volume };
  }
}
