import type { LegacyRow } from "../types.ts";
import { readPage, type LegacyDb } from "./db.ts";
export const mediaTables = [
  "media_tracks",
  "media_assets",
  "media_lists",
  "media_list_items",
  "user_queues",
] as const;
/** Read-only, bounded domain reader; no whole-table materialization. */
export function readMedia(
  db: LegacyDb,
  table: string,
  offset: number,
): LegacyRow[] {
  return readPage(db, table, offset);
}
