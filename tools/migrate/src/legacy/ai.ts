import type { LegacyRow } from "../types.ts";
import { readPage, type LegacyDb } from "./db.ts";
export const aiTables = [
  "ai_conversations",
  "ai_messages",
  "ai_credit_accounts",
  "ai_plan_enrollments",
  "ai_credit_reservations",
  "ai_credit_ledger",
  "ai_workspaces",
] as const;
/** Read-only, bounded domain reader; no whole-table materialization. */
export function readAi(
  db: LegacyDb,
  table: string,
  offset: number,
): LegacyRow[] {
  return readPage(db, table, offset);
}
