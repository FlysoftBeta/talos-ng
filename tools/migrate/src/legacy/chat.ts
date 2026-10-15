import type { LegacyRow } from "../types.ts";
import { readPage, type LegacyDb } from "./db.ts";
export const chatTables = [
  "posts",
  "convs_user",
  "post_images",
  "post_image_thumbs",
] as const;
/** Read-only, bounded domain reader; no whole-table materialization. */
export function readChat(
  db: LegacyDb,
  table: string,
  offset: number,
): LegacyRow[] {
  return readPage(db, table, offset);
}
