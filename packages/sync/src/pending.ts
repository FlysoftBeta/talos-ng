import { valid } from "./validate.ts";

export interface PendingPatch<T extends object> {
  readonly op: string;
  readonly patch: Readonly<Partial<T>>;
}

export interface PendingRow<T extends object> {
  readonly base: T;
  readonly value: T;
  readonly pending: readonly PendingPatch<T>[];
}

function project<T extends object>(
  base: T,
  pending: readonly PendingPatch<T>[],
): PendingRow<T> {
  const value = pending.reduce(
    (view, mark) => ({ ...view, ...mark.patch }),
    base,
  );
  return { base, value, pending };
}

export function pendingRow<T extends object>(base: T): PendingRow<T> {
  return project(base, []);
}

/** Shallow field replacement, in enqueue order. Patches must be immutable data. */
export function withPending<T extends object>(
  row: PendingRow<T>,
  op: string,
  patch: Readonly<Partial<T>>,
): PendingRow<T> {
  valid(op.length > 0, "Pending operation must be nonempty");
  valid(
    !row.pending.some((mark) => mark.op === op),
    "Operation is already pending on row",
  );
  return project(row.base, [...row.pending, { op, patch: { ...patch } }]);
}

export function updateAuthoritative<T extends object>(
  row: PendingRow<T>,
  base: T,
): PendingRow<T> {
  return project(base, row.pending);
}

/** Call after installing authoritative results. Never promote optimistic data to base. */
export function settle<T extends object>(
  row: PendingRow<T>,
  op: string,
): PendingRow<T> {
  return project(
    row.base,
    row.pending.filter((mark) => mark.op !== op),
  );
}

export function rollback<T extends object>(
  row: PendingRow<T>,
  op: string,
): PendingRow<T> {
  return settle(row, op);
}
