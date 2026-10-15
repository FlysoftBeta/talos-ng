import type { Db } from "../persistence/db.ts";

/** Object ids and sizes recorded in an object ledger database, in id order. The
 * objects owner answers this for any database holding its table, including a
 * read-only backup snapshot. */
export function* ledgerInventory(
  db: Pick<Db, "prepare">,
): Iterable<{ id: string; size: number }> {
  for (const row of db
    .prepare("SELECT id,size FROM objects ORDER BY id")
    .iterate())
    yield row as { id: string; size: number };
}
