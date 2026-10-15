import type { Db } from "../../kernel/persistence/db.ts";
import type { Catalog } from "./provider.ts";
export interface DownloadRow {
  job: string;
  user_id: string;
  book: string;
  collection: string;
  catalog: string | null;
  document: string | null;
}
export class NetbooksRepo {
  constructor(readonly db: Db) {}
  get(job: string): DownloadRow | undefined {
    return this.db.get<DownloadRow>(
      "SELECT * FROM netbooks_downloads WHERE job=?",
      job,
    );
  }
  downloads(user: string, book: string, collection: string): DownloadRow[] {
    return this.db.all<DownloadRow>(
      "SELECT * FROM netbooks_downloads WHERE user_id=? AND book=? AND collection=?",
      user,
      book,
      collection,
    );
  }
  insert(job: string, user: string, book: string, collection: string): void {
    this.db.run(
      "INSERT INTO netbooks_downloads(job,user_id,book,collection) VALUES(?,?,?,?)",
      job,
      user,
      book,
      collection,
    );
  }
  publish(job: string, doc: string): void {
    this.db.run(
      "UPDATE netbooks_downloads SET document=? WHERE job=?",
      doc,
      job,
    );
  }
  clearPublishedChapters(
    user: string,
    book: string,
    collection: string,
    doc: string,
  ): void {
    this.db.run(
      "DELETE FROM netbooks_chapters WHERE job IN (SELECT job FROM netbooks_downloads WHERE user_id=? AND book=? AND collection=? AND document=?)",
      user,
      book,
      collection,
      doc,
    );
  }
  catalog(job: string, value: Catalog): void {
    this.db.run(
      "UPDATE netbooks_downloads SET catalog=? WHERE job=?",
      JSON.stringify(value),
      job,
    );
  }
  chapter(job: string, ordinal: number): string | undefined {
    return this.db.get<{ body: string }>(
      "SELECT body FROM netbooks_chapters WHERE job=? AND ordinal=?",
      job,
      ordinal,
    )?.body;
  }
  save(job: string, ordinal: number, body: string): void {
    this.db.run(
      "INSERT INTO netbooks_chapters VALUES(?,?,?)",
      job,
      ordinal,
      body,
    );
  }
}
