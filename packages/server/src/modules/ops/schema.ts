import type { Migration } from "../../kernel/persistence/db.ts";
export const opsMigrations: readonly Migration[] = [
  {
    n: 1,
    up: (db) =>
      db.exec(`
CREATE TABLE ops_downloads(object_id TEXT NOT NULL,user_id TEXT NOT NULL,expires INTEGER NOT NULL,backup_id TEXT NOT NULL,PRIMARY KEY(object_id,user_id)) STRICT;
CREATE TABLE ops_settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL CHECK(json_valid(value))) STRICT;
INSERT INTO ops_settings VALUES(1,'{"retention":5,"daily":true,"cloudEnabled":false,"autoCheck":false,"manifestUrl":""}');
CREATE TABLE ops_backups(id TEXT PRIMARY KEY,created INTEGER NOT NULL,size INTEGER NOT NULL) STRICT;
CREATE TABLE ops_office(id TEXT PRIMARY KEY,name TEXT NOT NULL,application TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('word','powerpoint','excel')),object_id TEXT NOT NULL REFERENCES objects(id),size INTEGER NOT NULL,created INTEGER NOT NULL) STRICT;
CREATE INDEX ops_office_object ON ops_office(object_id);
`),
  },
];
