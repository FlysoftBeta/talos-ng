import type { Migration } from "../../kernel/persistence/db.ts";
export const netbooksMigrations: readonly Migration[] = [
  {
    n: 1,
    up(db) {
      db.exec(`
CREATE TABLE netbooks_downloads(job TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),book TEXT NOT NULL,collection TEXT NOT NULL,catalog TEXT CHECK(catalog IS NULL OR json_valid(catalog)),document TEXT) STRICT;
CREATE INDEX netbooks_download_key ON netbooks_downloads(user_id,book,collection);
CREATE TABLE netbooks_chapters(job TEXT NOT NULL REFERENCES netbooks_downloads(job) ON DELETE CASCADE,ordinal INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(job,ordinal)) STRICT;
`);
    },
  },
];
