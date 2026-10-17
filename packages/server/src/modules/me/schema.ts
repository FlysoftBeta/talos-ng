import type { Migration } from "../../kernel/persistence/db.ts";
export const meMigrations: readonly Migration[] = [
  {
    n: 1,
    up(db) {
      db.exec(
        `CREATE TABLE me_settings(user_id TEXT NOT NULL REFERENCES users(id),key TEXT NOT NULL,value TEXT NOT NULL CHECK(json_valid(value)),rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),PRIMARY KEY(user_id,key)) STRICT; CREATE INDEX me_settings_rev ON me_settings(user_id,rev,key);`,
      );
    },
  },
];
