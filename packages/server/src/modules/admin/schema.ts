import type { Migration } from "../../kernel/persistence/db.ts";
export const adminMigrations: readonly Migration[] = [
  {
    n: 1,
    up(db) {
      db.exec(`CREATE TABLE admin_settings(id INTEGER PRIMARY KEY CHECK(id=1),max_volume REAL NOT NULL DEFAULT 1 CHECK(max_volume>=0 AND max_volume<=1)) STRICT;
INSERT INTO admin_settings(id) VALUES(1);`);
    },
  },
  {
    n: 2,
    up(db) {
      db.exec(
        "CREATE TABLE admin_downloads(object_id TEXT NOT NULL,user_id TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(object_id,user_id)) STRICT",
      );
    },
  },
  {
    n: 3,
    up(db) {
      db.exec(
        `CREATE TABLE admin_announcement_revisions(revision INTEGER PRIMARY KEY,title TEXT NOT NULL,text TEXT NOT NULL,published INTEGER NOT NULL) STRICT;`,
      );
    },
  },
];
