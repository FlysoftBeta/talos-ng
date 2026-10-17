import { integer, valid } from "./validate.ts";

export interface Row<T = unknown> {
  readonly type: string;
  readonly id: string;
  readonly rev: number;
  readonly deleted: boolean;
  readonly data: T;
}

export interface ScopePull {
  readonly rows: readonly Row[];
  readonly cursor: number;
  readonly more: boolean;
  readonly reset?: readonly string[];
  /** Windowed rows are included (else the server omitted them). */
  readonly windowed?: boolean;
}

export function checkRow(row: Row): void {
  integer(row.rev, "revision");
  valid(
    typeof row.type === "string" && row.type.length > 0,
    "Invalid row type",
  );
  valid(typeof row.id === "string" && row.id.length > 0, "Invalid row id");
  valid(typeof row.deleted === "boolean", "Invalid deletion flag");
}

/** limit is a soft row cap: a whole transaction/revision always travels together. */
export function selectDelta(
  rowsSortedByRev: readonly Row[],
  cursor: number,
  limit: number,
): ScopePull {
  integer(cursor, "cursor");
  integer(limit, "limit", 1);
  let previous = 0;
  for (const row of rowsSortedByRev) {
    checkRow(row);
    valid(row.rev >= previous, "Rows must be sorted by revision");
    previous = row.rev;
  }
  const start = rowsSortedByRev.findIndex((row) => row.rev > cursor);
  if (start < 0) return { rows: [], cursor, more: false };
  let end = Math.min(start + limit, rowsSortedByRev.length);
  while (
    end < rowsSortedByRev.length &&
    rowsSortedByRev[end]!.rev === rowsSortedByRev[end - 1]!.rev
  )
    end++;
  const rows = rowsSortedByRev.slice(start, end);
  return {
    rows,
    cursor: rows[rows.length - 1]!.rev,
    more: end < rowsSortedByRev.length,
  };
}
