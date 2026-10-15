import type { Db } from "../../kernel/persistence/db.ts";
export class LearningPurgeRepo {
  constructor(private readonly db: Db) {}
  purgeUser(user: string): void {
    const db = this.db;
    db.run("DELETE FROM learning_progress WHERE user_id=?", user);
  }
}
