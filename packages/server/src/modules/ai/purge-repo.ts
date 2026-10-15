import type { Db } from "../../kernel/persistence/db.ts";
export class AiPurgeRepo {
  constructor(private readonly db: Db) {}
  purgeUser(user: string): void {
    const db = this.db;

    db.run(
      "DELETE FROM ai_tools WHERE run IN (SELECT id FROM ai_runs WHERE user=?)",
      user,
    );
    db.run("DELETE FROM ai_messages WHERE user=?", user);
    db.run("DELETE FROM ai_runs WHERE user=?", user);
    db.run("DELETE FROM ai_rows WHERE user=?", user);
    db.run("DELETE FROM ai_accounts WHERE user=?", user);
    db.run("DELETE FROM ai_ledger WHERE user=?", user);
    db.run("DELETE FROM ai_files WHERE user=?", user);
    db.run("DELETE FROM ai_texts WHERE user=?", user);
  }
}
