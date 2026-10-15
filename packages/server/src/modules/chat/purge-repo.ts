import type { Db } from "../../kernel/persistence/db.ts";
import type { WriteContext } from "../../kernel/persistence/uow.ts";
import type { PurgePorts } from "./purge.ts";
export class ChatPurgeRepo {
  constructor(private readonly db: Db) {}
  purgeUser(user: string, _tx: WriteContext, domains: PurgePorts): void {
    const db = this.db;

    for (const row of db.all<{ id: string }>(
      "SELECT id FROM chat_posts WHERE author=?",
      user,
    ))
      domains.removeRefs("chat-post", row.id);
    for (const row of db.all<{ id: string }>(
      "SELECT id FROM chat_posts WHERE author=? AND deleted=0",
      user,
    ))
      domains.deletePost(row.id);
    db.run("DELETE FROM chat_states WHERE user=?", user);
    db.run("DELETE FROM chat_texts WHERE user=?", user);
    db.run("DELETE FROM chat_ack WHERE user=?", user);
    db.run("DELETE FROM chat_mutes WHERE user=?", user);
  }
}
