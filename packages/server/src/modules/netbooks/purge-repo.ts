import type { Db } from "../../kernel/persistence/db.ts";
export class NetbooksPurgeRepo {
  constructor(private readonly db: Db) {}
  purgeUser(user: string): void {
    const db = this.db;
    // netbooks_chapters belongs to each download and is deleted by its FK CASCADE.

    db.run("DELETE FROM netbooks_downloads WHERE user_id=?", user);
  }
}
