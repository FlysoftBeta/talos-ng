import type { Db } from "../../kernel/persistence/db.ts";
export class AdminRepo {
  constructor(readonly db: Db) {}
  settings(): { maxVolume: number; evictionDays: number } {
    const row = this.db.get<{ max_volume: number; eviction_days: number }>(
      "SELECT max_volume,eviction_days FROM admin_settings WHERE id=1",
    )!;
    return { maxVolume: row.max_volume, evictionDays: row.eviction_days };
  }
}
