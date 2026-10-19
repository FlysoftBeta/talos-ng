import type { Migration } from "../../kernel/persistence/db.ts";
/**
 * The learning feature was removed. Its migration history stays so existing
 * databases apply the drop; new databases never create the tables.
 */
export const learningMigrations: readonly Migration[] = [
  { n: 1, up() {} },
  {
    n: 2,
    up(db) {
      db.exec(`
      DROP TABLE IF EXISTS learning_progress;
      DROP TABLE IF EXISTS learning_corpus;
      DROP TABLE IF EXISTS learning_words;
    `);
    },
  },
];
