import { IntervalSet } from "./intervals.ts";
import type { IntervalSetJSON } from "./intervals.ts";
import { integer, own, valid } from "./validate.ts";

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
}

export interface ScopeState {
  readonly cursor: number;
  readonly windows: Readonly<Record<string, IntervalSetJSON>>;
}

/** Executors must keep deletion revisions, and apply rows only if rev > heldRev. */
export type ApplyOperation =
  | { readonly kind: "put"; readonly row: Row; readonly ifNewer: true }
  | {
      readonly kind: "delete";
      readonly type: string;
      readonly id: string;
      readonly rev: number;
      readonly ifNewer: true;
    }
  | { readonly kind: "dropType"; readonly type: string }
  | { readonly kind: "setCursor"; readonly cursor: number }
  | {
      readonly kind: "setWindow";
      readonly type: string;
      readonly intervals: IntervalSetJSON;
    };

export interface ApplyOptions {
  readonly windowed: Readonly<
    Record<string, { readonly seqOf: (row: Row) => number }>
  >;
}

function checkRow(row: Row): void {
  integer(row.rev, "revision");
  valid(
    typeof row.type === "string" && row.type.length > 0,
    "Invalid row type",
  );
  valid(typeof row.id === "string" && row.id.length > 0, "Invalid row id");
  valid(typeof row.deleted === "boolean", "Invalid deletion flag");
}

function rowOperation(row: Row): ApplyOperation {
  return row.deleted
    ? {
        kind: "delete",
        type: row.type,
        id: row.id,
        rev: row.rev,
        ifNewer: true,
      }
    : { kind: "put", row, ifNewer: true };
}

/** Buffer pages and pass the whole ordered chain. Incomplete chains produce no ops. */
export function planApply(
  state: ScopeState,
  pull: ScopePull | readonly ScopePull[],
  options: ApplyOptions,
): readonly ApplyOperation[] {
  integer(state.cursor, "state cursor");
  const pages: readonly ScopePull[] = Array.isArray(pull)
    ? pull
    : [pull as ScopePull];
  if (pages.length === 0) return [];
  let previous = state.cursor;
  pages.forEach((page, index) => {
    integer(page.cursor, "pull cursor");
    valid(page.cursor >= previous, "Pull cursor moved backwards");
    valid(index === pages.length - 1 || page.more, "Page after completed pull");
    for (const row of page.rows) {
      checkRow(row);
      valid(row.rev <= page.cursor, "Row exceeds page cursor");
    }
    previous = page.cursor;
  });
  if (pages[pages.length - 1]!.more) return [];

  const ops: ApplyOperation[] = [];
  // A later reset invalidates earlier rows for that type in this pull.
  const grouped = new Map<string, Row[]>();
  const resets = new Set<string>();
  for (const page of pages) {
    for (const type of page.reset ?? []) {
      valid(typeof type === "string" && type.length > 0, "Invalid reset type");
      resets.add(type);
      grouped.delete(type);
    }
    for (const row of page.rows) {
      let rows = grouped.get(row.type);
      if (!rows) {
        rows = [];
        grouped.set(row.type, rows);
      }
      rows.push(row);
    }
  }
  for (const type of resets) {
    ops.push(
      { kind: "dropType", type },
      { kind: "setWindow", type, intervals: [] },
    );
  }
  for (const [type, rows] of grouped) {
    const config = own(options.windowed, type);
    if (!config) {
      for (const row of rows) ops.push(rowOperation(row));
      continue;
    }
    let windows = new IntervalSet(
      resets.has(type) ? [] : (own(state.windows, type) ?? []),
    );
    // Rev order is unrelated to sequence order; sort once so a whole contiguous
    // suffix is accepted even when its rows arrived on different pull pages.
    const sequenced = rows
      .map((row) => {
        const seq = config.seqOf(row);
        integer(seq, "row sequence");
        return { row, seq };
      })
      .sort((a, b) => a.seq - b.seq || a.row.rev - b.row.rev);
    for (const { row, seq } of sequenced) {
      const head = windows.head();
      if (head && seq === head[1] + 1) windows = windows.add(seq);
      if (windows.contains(seq)) ops.push(rowOperation(row));
    }
    ops.push({ kind: "setWindow", type, intervals: windows.toJSON() });
  }
  ops.push({ kind: "setCursor", cursor: previous });
  return ops;
}

export interface PageRange {
  readonly lo: number;
  readonly hi: number;
  readonly complete: boolean;
  /** Optional validation when the page's wire schema exposes a sequence. */
  readonly seqOf?: (row: Row) => number;
}

/** complete certifies all rows/tombstones in [lo,hi] have been received. */
export function mergePage(
  state: ScopeState,
  type: string,
  pageRows: readonly Row[],
  range: PageRange,
): readonly ApplyOperation[] {
  valid(type.length > 0, "Invalid page type");
  const window = new IntervalSet([[range.lo, range.hi]]);
  for (const row of pageRows) {
    checkRow(row);
    valid(row.type === type, "Page contains another type");
    if (range.seqOf)
      valid(
        window.contains(range.seqOf(row)),
        "Page row outside declared range",
      );
  }
  if (!range.complete) return [];
  const intervals = new IntervalSet(own(state.windows, type) ?? [])
    .add(range.lo, range.hi)
    .toJSON();
  return [
    ...pageRows.map(rowOperation),
    { kind: "setWindow", type, intervals },
  ];
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
