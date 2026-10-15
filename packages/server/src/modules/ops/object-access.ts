import type { Db } from "../../kernel/persistence/db.ts";
export class OpsObjectAccess {
  constructor(private readonly db: Db) {}
  office(objectId: string): boolean {
    return !!this.db.get(
      "SELECT 1 FROM ops_office WHERE object_id=?",
      objectId,
    );
  }
  backup(user: string, objectId: string, now: number): boolean {
    return !!this.db.get(
      "SELECT 1 FROM ops_downloads WHERE object_id=? AND user_id=? AND expires>?",
      objectId,
      user,
      now,
    );
  }
}
