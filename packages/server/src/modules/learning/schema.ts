import type { Migration } from "../../kernel/persistence/db.ts";
export const learningMigrations: readonly Migration[] = [
  {
    n: 1,
    up(db) {
      db.exec(`
      CREATE TABLE learning_words(id TEXT PRIMARY KEY,english TEXT NOT NULL UNIQUE,definition TEXT NOT NULL) STRICT;
      CREATE TABLE learning_corpus(id TEXT PRIMARY KEY,body TEXT NOT NULL CHECK(json_valid(body)),rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1))) STRICT;
      CREATE INDEX learning_corpus_rev ON learning_corpus(rev);
      CREATE TABLE learning_progress(user_id TEXT NOT NULL REFERENCES users(id),word_id TEXT NOT NULL REFERENCES learning_words(id),body TEXT NOT NULL CHECK(json_valid(body)),rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)),PRIMARY KEY(user_id,word_id)) STRICT;
      CREATE INDEX learning_progress_rev ON learning_progress(user_id,rev,word_id);
    `);
    },
  },
];
