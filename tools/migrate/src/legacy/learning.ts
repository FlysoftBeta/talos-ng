import type { LegacyRow } from "../types.ts";
import { readPage, type LegacyDb } from "./db.ts";
export const learningTables = ["words", "user_word_progress"] as const;
/** Read-only, bounded domain reader; no whole-table materialization. */
export function readLearning(
  db: LegacyDb,
  table: string,
  offset: number,
): LegacyRow[] {
  return readPage(db, table, offset);
}
