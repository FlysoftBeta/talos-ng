import type { Db } from "../../kernel/persistence/db.ts";
export class MePurgeRepo {
  constructor(private readonly db: Db) {}
  purgeUser(user: string): void {
    const db = this.db;
    db.run("DELETE FROM me_settings WHERE user_id=?", user);
  }
}
