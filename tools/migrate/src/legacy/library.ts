import type { LegacyRow } from "../types.ts";
import { readPage, type LegacyDb } from "./db.ts";
export const libraryTables = [
  "articles",
  "text_article_segments",
  "booklists",
  "booklist_items",
  "group_booklists",
  "access_bindings",
  "resource_possession",
  "user_favorites",
  "article_read_progress",
] as const;
/** Read-only, bounded domain reader; no whole-table materialization. */
export function readLibrary(
  db: LegacyDb,
  table: string,
  offset: number,
): LegacyRow[] {
  return readPage(db, table, offset);
}
