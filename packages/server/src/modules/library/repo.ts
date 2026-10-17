import type {
  LibraryRetention,
  LibraryDoc,
  LibraryCollection,
  LibraryState,
} from "@talos/contract";
import type { Row } from "@talos/sync";
import type { Db } from "../../kernel/persistence/db.ts";
export interface RecordRow {
  id: string;
  body: string;
  rev: number;
  deleted: number;
  owner?: string;
  source?: string;
  filename?: string;
}
export class LibraryRepo {
  constructor(private readonly db: Db) {}
  retention(user: string, id: string): LibraryRetention | undefined {
    const row = this.db.get<{ body: string }>(
      "SELECT body FROM library_retentions WHERE user_id=? AND id=?",
      user,
      id,
    );
    return row ? (JSON.parse(row.body) as LibraryRetention) : undefined;
  }
  retentions(user: string): RecordRow[] {
    return this.db.all(
      "SELECT id,body,rev,0 AS deleted FROM library_retentions WHERE user_id=? ORDER BY rev,id",
      user,
    );
  }
  putRetention(user: string, value: LibraryRetention, rev: number): void {
    this.db.run(
      "INSERT INTO library_retentions VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET body=excluded.body,rev=excluded.rev",
      user,
      value.id,
      JSON.stringify(value),
      rev,
    );
  }
  docs(): RecordRow[] {
    return this.db.all("SELECT * FROM library_documents ORDER BY rev,id");
  }
  doc(id: string): RecordRow | undefined {
    return this.db.get("SELECT * FROM library_documents WHERE id=?", id);
  }
  collections(): RecordRow[] {
    return this.db.all("SELECT * FROM library_collections ORDER BY rev,id");
  }
  /**
   * Live collections whose items include the document: a superset of those
   * listing it in their body (the body never lists a document without an item).
   */
  collectionsWithItem(doc: string): RecordRow[] {
    return this.db.all(
      "SELECT c.* FROM library_items i JOIN library_collections c ON c.id=i.collection WHERE i.id=? AND i.deleted=0 AND c.deleted=0 ORDER BY c.rev,c.id",
      doc,
    );
  }
  ownedCollections(owner: string): RecordRow[] {
    return this.db.all(
      "SELECT * FROM library_collections WHERE owner=? ORDER BY rev,id",
      owner,
    );
  }
  ownedDocs(owner: string): RecordRow[] {
    return this.db.all(
      "SELECT * FROM library_documents WHERE owner=? ORDER BY rev,id",
      owner,
    );
  }
  collection(id: string): RecordRow | undefined {
    return this.db.get("SELECT * FROM library_collections WHERE id=?", id);
  }
  state(user: string, id: string): RecordRow | undefined {
    return this.db.get(
      "SELECT * FROM library_states WHERE user_id=? AND id=?",
      user,
      id,
    );
  }
  states(user: string): RecordRow[] {
    return this.db.all(
      "SELECT * FROM library_states WHERE user_id=? ORDER BY rev,id",
      user,
    );
  }
  putDoc(
    doc: LibraryDoc,
    source: string,
    filename: string,
    rev: number,
    deleted = false,
  ): void {
    this.db.run(
      "INSERT INTO library_documents VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source=excluded.source,filename=excluded.filename,body=excluded.body,rev=excluded.rev,deleted=excluded.deleted",
      doc.id,
      doc.owner,
      deleted ? "" : source,
      deleted ? "" : filename,
      JSON.stringify(deleted ? {} : doc),
      rev,
      +deleted,
    );
  }
  /** Migration only: attach immutable legacy bytes to a processing document. */
  attachImportedSource(id: string, source: string, filename: string): void {
    this.db.run(
      "UPDATE library_documents SET source=?,filename=? WHERE id=? AND source='' AND deleted=0",
      source,
      filename,
      id,
    );
  }
  putCollection(
    collection: LibraryCollection,
    rev: number,
    deleted = false,
  ): void {
    this.db.run(
      "INSERT INTO library_collections VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,rev=excluded.rev,deleted=excluded.deleted",
      collection.id,
      collection.owner,
      JSON.stringify(collection),
      rev,
      +deleted,
    );
  }
  putState(user: string, state: LibraryState, rev: number): void {
    this.db.run(
      "INSERT INTO library_states VALUES(?,?,?,?,0) ON CONFLICT(user_id,id) DO UPDATE SET body=excluded.body,rev=excluded.rev,deleted=0",
      user,
      state.id,
      JSON.stringify(state),
      rev,
    );
  }
  items(collection: string): { id: string; rev: number; deleted: number }[] {
    return this.db.all(
      "SELECT id,rev,deleted FROM library_items WHERE collection=? ORDER BY rev,id",
      collection,
    );
  }
  replaceItems(collection: string, ids: string[], rev: number): void {
    this.db.run(
      "UPDATE library_items SET deleted=1,rev=? WHERE collection=? AND deleted=0",
      rev,
      collection,
    );
    for (const id of ids)
      this.db.run(
        "INSERT INTO library_items VALUES(?,?,?,0) ON CONFLICT(collection,id) DO UPDATE SET rev=excluded.rev,deleted=0",
        collection,
        id,
        rev,
      );
  }
  hasContainer(id: string): boolean {
    return !!this.db.get(
      "SELECT 1 FROM library_items i JOIN library_collections c ON c.id=i.collection WHERE i.id=? AND i.deleted=0 AND c.deleted=0 LIMIT 1",
      id,
    );
  }
  deleteStates(id: string, rev: number): string[] {
    const users = this.db
      .all<{ user_id: string }>(
        "SELECT user_id FROM library_states WHERE id=? AND deleted=0",
        id,
      )
      .map((row) => row.user_id);
    this.db.run(
      "UPDATE library_states SET body='{}',deleted=1,rev=? WHERE id=?",
      rev,
      id,
    );
    return users;
  }
  clearDelegations(id: string): void {
    this.db.run("DELETE FROM library_delegations WHERE collection=?", id);
  }
  delegation(collection: string, type: string, principal: string): boolean {
    return !!this.db.get<{ delegable: number }>(
      "SELECT delegable FROM library_delegations WHERE collection=? AND principal_type=? AND principal=?",
      collection,
      type,
      principal,
    )?.delegable;
  }
  delegate(
    collection: string,
    type: string,
    principal: string,
    value: boolean,
  ): void {
    this.db.run(
      "INSERT INTO library_delegations VALUES(?,?,?,?) ON CONFLICT(collection,principal_type,principal) DO UPDATE SET delegable=excluded.delegable",
      collection,
      type,
      principal,
      +value,
    );
  }
  row(type: string, row: RecordRow): Row {
    return {
      type,
      id: row.id,
      rev: row.rev,
      deleted: !!row.deleted,
      data: row.deleted ? null : (JSON.parse(row.body) as unknown),
    };
  }
}
