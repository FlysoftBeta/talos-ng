import type { LegacyRow } from "../types.ts";
import { readPage, type LegacyDb } from "./db.ts";
export const communityTables = ["groups", "group_members", "dms"] as const;
/** Read-only, bounded domain reader; no whole-table materialization. */
export function readCommunity(
  db: LegacyDb,
  table: string,
  offset: number,
): LegacyRow[] {
  return readPage(db, table, offset);
}
