import type { Db } from "../../kernel/persistence/db.ts";
export class IdentityPurgeRepo {
  constructor(private readonly db: Db) {}
  prepare(user: string, rev: number): void {
    this.db.run("UPDATE users SET purging=1,rev=? WHERE id=?", rev, user);
    this.db.run("DELETE FROM sessions WHERE user_id=?", user);
  }
  remove(user: string): void {
    this.db.run("UPDATE devices SET bound_user=NULL WHERE bound_user=?", user);
    this.db.run(
      "UPDATE invitations SET claimed_by=NULL WHERE claimed_by=?",
      user,
    );
    this.db.run("DELETE FROM sessions WHERE user_id=?", user);
    this.db.run("DELETE FROM user_pins WHERE user_id=?", user);
    this.db.run("DELETE FROM users WHERE id=?", user);
  }
}
