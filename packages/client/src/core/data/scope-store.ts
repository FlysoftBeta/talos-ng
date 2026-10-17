import { EMPTY_COVERAGE, rowKey } from "@talos/sync";
import type { Replica } from "@talos/sync";
import type { LockManagerLike, Transaction, TxTask } from "@talos/store";
import type { StoredRow, StoredScope } from "./db.ts";

/**
 * One serialized writer per scope across tabs. Every replica merge runs inside the
 * locks of the scopes it touches, taken in sorted order so tabs cannot deadlock.
 * Without Web Locks the single readwrite transaction that reads, merges and writes
 * the replica is the serialization: IndexedDB never interleaves two of them.
 */
export class ScopeLocks {
  private readonly locks: LockManagerLike | null;
  constructor(locks?: LockManagerLike | null) {
    this.locks =
      locks !== undefined
        ? locks
        : typeof navigator !== "undefined" &&
            (navigator as { locks?: LockManagerLike }).locks
          ? (navigator as { locks: LockManagerLike }).locks
          : null;
  }
  run<T>(scopes: Iterable<string>, fn: () => Promise<T>): Promise<T> {
    const locks = this.locks;
    if (!locks) return fn();
    const names = [...new Set(scopes)].sort();
    const take = (index: number): Promise<T> =>
      index === names.length
        ? fn()
        : locks.request(`talos-sync:${names[index]!}`, () => take(index + 1));
    return take(0);
  }
}

export interface HeldReplica {
  readonly replica: Replica;
  readonly saved: boolean;
}

type Replicas = ReadonlyMap<string, HeldReplica>;

/** Reads the stored replicas of `scopes` (rows by key range), then continues in the transaction. */
export function readReplicas<R>(
  tx: Transaction,
  scopes: readonly string[],
  then: (replicas: Replicas) => R,
): TxTask<R> | R {
  const out = new Map<string, HeldReplica>();
  const rows = tx.table<StoredRow>("rows");
  const records = tx.table<StoredScope, string>("scopes");
  const read = (index: number): TxTask<R> | R => {
    if (index === scopes.length) return then(out);
    const scope = scopes[index]!;
    return records.get(scope).then((record) =>
      rows.range({ lower: [scope], upper: [scope, []] }).then((held) => {
        out.set(scope, {
          saved: record !== undefined,
          replica: {
            coverage: record?.coverage ?? EMPTY_COVERAGE,
            rows: new Map(held.map((row) => [rowKey(row.type, row.id), row])),
          },
        });
        return read(index + 1);
      }),
    );
  };
  return read(0);
}

/** Writes the difference between two replicas of one scope. */
export function writeReplica(
  tx: Transaction,
  scope: string,
  before: HeldReplica,
  after: Replica,
): void {
  const rows = tx.table<StoredRow>("rows");
  for (const [key, row] of before.replica.rows)
    if (!after.rows.has(key)) rows.delete([scope, row.type, row.id]);
  for (const [key, row] of after.rows)
    if (before.replica.rows.get(key) !== row) rows.put({ ...row, scope });
  const scopes = tx.table<StoredScope, string>("scopes");
  const empty =
    after.rows.size === 0 &&
    after.coverage.revs.length === 0 &&
    Object.keys(after.coverage.types).length === 0;
  if (empty) {
    if (before.saved) scopes.delete(scope);
  } else scopes.put({ scope, coverage: after.coverage });
}
