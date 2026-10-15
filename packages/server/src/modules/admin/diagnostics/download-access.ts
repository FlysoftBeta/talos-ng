import type { Db } from "../../../kernel/persistence/db.ts";
export class AdminDownloadAccess {
  constructor(private readonly db: Db) {}
  downloadable(user: string, objectId: string, now: number): boolean {
    return !!this.db.get(
      "SELECT 1 FROM admin_downloads WHERE object_id=? AND user_id=? AND expires>?",
      objectId,
      user,
      now,
    );
  }
}
