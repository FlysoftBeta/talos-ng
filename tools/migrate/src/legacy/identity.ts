import type { LegacyRow } from "../types.ts";
import { readPage, type LegacyDb } from "./db.ts";
export const identityTables = [
  "users",
  "user_pins",
  "user_admin_roles",
  "deleted_users",
  "clients",
  "ghost_users",
] as const;
/** Read-only, bounded domain reader; no whole-table materialization. */
export function readIdentity(
  db: LegacyDb,
  table: string,
  offset: number,
): LegacyRow[] {
  return readPage(db, table, offset);
}
