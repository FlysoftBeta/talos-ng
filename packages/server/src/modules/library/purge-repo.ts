import type { Db } from "../../kernel/persistence/db.ts";
import type { WriteContext } from "../../kernel/persistence/uow.ts";
import type { PurgePorts } from "./purge.ts";
export class LibraryPurgeRepo {
  constructor(private readonly db: Db) {}
  purgeUser(user: string, ctx: WriteContext, domains: PurgePorts): void {
    const db = this.db;
    db.run("DELETE FROM library_retentions WHERE user_id=?", user);

    for (const row of db.all<{ id: string; deleted: number }>(
      "SELECT id,deleted FROM library_documents WHERE owner=?",
      user,
    )) {
      if (!row.deleted) domains.deleteDoc(row.id);
      domains.removeRefs("library.pack", row.id);
      domains.removeRefs("library.source", row.id);
    }
    for (const row of db.all<{ id: string; deleted: number }>(
      "SELECT id,deleted FROM library_collections WHERE owner=?",
      user,
    )) {
      domains.revokeResource(`coll:${row.id}`, ctx);
      if (!row.deleted) domains.deleteCollection(row.id);
    }
    db.run(
      "DELETE FROM library_items WHERE collection IN (SELECT id FROM library_collections WHERE owner=?)",
      user,
    );
    db.run(
      "DELETE FROM library_delegations WHERE collection IN (SELECT id FROM library_collections WHERE owner=?)",
      user,
    );
    db.run(
      "DELETE FROM library_delegations WHERE principal_type='user' AND principal=?",
      user,
    );
    db.run("DELETE FROM library_states WHERE user_id=?", user);
    db.run("DELETE FROM library_collections WHERE owner=?", user);
    db.run("DELETE FROM library_documents WHERE owner=?", user);
  }
}
