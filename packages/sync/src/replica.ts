import { IntervalSet } from "./intervals.ts";
import type { IntervalSetJSON } from "./intervals.ts";
import { checkRow } from "./delta.ts";
import type { Row, ScopePull } from "./delta.ts";
import { integer, own, valid } from "./validate.ts";

/**
 * `[lo, hi, at]`: the stored state of every sequence number in `lo..hi` is at least
 * the server state at revision `at` (a missing row there means no row existed).
 */
export type KnownRange = readonly [lo: number, hi: number, at: number];

export interface TypeCoverage {
  /** Revisions whose every change of this type reached the replica. */
  readonly revs: IntervalSetJSON;
  /** Sorted, disjoint, closed under `revs` and merged where adjacent with equal `at`. */
  readonly known: readonly KnownRange[];
  /**
   * Evicted sequences: facts about them below the given revision are ignored, since
   * the changes `revs` vouches for were thrown away with the rows.
   */
  readonly cut?: readonly KnownRange[];
}

/**
 * What a scope replica knows, as explicit facts. `revs` holds the revisions whose
 * every change of the scope's mirrored (non-windowed) types arrived; `0` is
 * present once a chain from the empty start arrived, so the cursor is the top of
 * the run starting at zero. Windowed types record their own coverage.
 */
export interface Coverage {
  readonly revs: IntervalSetJSON;
  readonly types: Readonly<Record<string, TypeCoverage>>;
}

export interface Replica {
  readonly coverage: Coverage;
  /** Keyed by `rowKey(type, id)`. */
  readonly rows: ReadonlyMap<string, Row>;
}

export type WindowedTypes = Readonly<
  Record<string, { readonly seqOf: (row: Row) => number }>
>;

/**
 * Everything that changes a replica. Remote inputs (chains, pages, rows) only add
 * facts, so they merge in any order and any number of times to the same replica;
 * `evict` and `purge` are the explicit removals.
 */
export type Inbound =
  /** A complete pull or push chain continuing the server's stream from `from`. */
  | {
      readonly kind: "chain";
      readonly from: number;
      readonly pages: readonly ScopePull[];
    }
  /** A window page: every row of `type` with a sequence in lo..hi at revision `rev`. */
  | {
      readonly kind: "page";
      readonly type: string;
      readonly rows: readonly Row[];
      readonly lo: number;
      readonly hi: number;
      readonly rev: number;
    }
  /** Authoritative rows read individually, such as a write's result. */
  | { readonly kind: "rows"; readonly rows: readonly Row[] }
  /** Cache eviction: forget these windowed rows and their coverage. */
  | {
      readonly kind: "evict";
      readonly type: string;
      readonly ids: readonly string[];
    }
  /** Revocation or reassignment: forget the whole scope. */
  | { readonly kind: "purge" };

export const EMPTY_COVERAGE: Coverage = Object.freeze({
  revs: [],
  types: {},
});
export const EMPTY_REPLICA: Replica = Object.freeze({
  coverage: EMPTY_COVERAGE,
  rows: new Map<string, Row>(),
});

export function rowKey(type: string, id: string): string {
  return JSON.stringify([type, id]);
}

/** The revision through which every mirrored row of the scope is held. */
export function cursorOf(coverage: Coverage): number {
  const run = new IntervalSet(coverage.revs).covering(0);
  return run ? run[1] : 0;
}

/** A complete chain from the empty start arrived (the scope may still be empty). */
export function isComplete(coverage: Coverage): boolean {
  return new IntervalSet(coverage.revs).contains(0);
}

/** Whether any windowed type holds known rows; pulls then ask for its windowed rows. */
export function holdsWindow(coverage: Coverage | undefined): boolean {
  return Object.values(coverage?.types ?? {}).some(
    (type) => type.known.length > 0,
  );
}

/**
 * Sequence numbers in lo..hi whose stored state is not known to be current at the
 * scope cursor: never loaded, evicted, or loaded before changes the replica did
 * not receive. Every one of them is a hole to fetch; nothing else can be missing.
 */
export function holes(
  coverage: Coverage,
  type: string,
  lo: number,
  hi: number,
): IntervalSetJSON {
  integer(lo, "hole lower bound");
  integer(hi, "hole upper bound");
  if (lo > hi) return [];
  const cursor = cursorOf(coverage);
  let current = new IntervalSet();
  for (const [a, b, at] of own(coverage.types, type)?.known ?? [])
    if (at >= cursor && b >= lo && a <= hi)
      current = current.add(Math.max(a, lo), Math.min(b, hi));
  return current.gapsWithin(lo, hi);
}

/** Incoming wins over held by revision; a windowed tombstone is final. */
function wins(
  held: Row | undefined,
  incoming: Row,
  windowed: boolean,
): boolean {
  if (!held) return true;
  if (windowed && held.deleted !== incoming.deleted) return incoming.deleted;
  return incoming.rev > held.rev;
}

function atOf(known: readonly KnownRange[], seq: number): number | undefined {
  let lo = 0;
  let hi = known.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const range = known[mid]!;
    if (seq < range[0]) hi = mid - 1;
    else if (seq > range[1]) lo = mid + 1;
    else return range[2];
  }
  return undefined;
}

/** Combines two sorted disjoint range lists segment by segment. */
function combine(
  a: readonly KnownRange[],
  b: readonly KnownRange[],
  f: (x: number | undefined, y: number | undefined) => number | undefined,
): KnownRange[] {
  const points = new Set<number>();
  for (const [lo, hi] of a) points.add(lo).add(hi + 1);
  for (const [lo, hi] of b) points.add(lo).add(hi + 1);
  const bounds = [...points].sort((x, y) => x - y);
  const out: KnownRange[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const lo = bounds[i]!;
    const x = atOf(a, lo);
    const y = atOf(b, lo);
    if (x === undefined && y === undefined) continue;
    const value = f(x, y);
    if (value !== undefined) push(out, [lo, bounds[i + 1]! - 1, value]);
  }
  return out;
}

const max = (x: number | undefined, y: number | undefined): number =>
  Math.max(x ?? -1, y ?? -1);

function push(out: KnownRange[], range: KnownRange): void {
  const last = out[out.length - 1];
  if (last && last[2] === range[2] && last[1] + 1 === range[0])
    out[out.length - 1] = [last[0], range[1], last[2]];
  else out.push(range);
}

function removeKnown(
  known: readonly KnownRange[],
  lo: number,
  hi: number,
): KnownRange[] {
  const out: KnownRange[] = [];
  for (const [a, b, at] of known) {
    if (b < lo || a > hi) out.push([a, b, at]);
    else {
      if (a < lo) out.push([a, lo - 1, at]);
      if (b > hi) out.push([hi + 1, b, at]);
    }
  }
  return out;
}

/** Each `at` advances through the revisions whose changes all arrived after it. */
function close(type: TypeCoverage): TypeCoverage {
  const revs = new IntervalSet(type.revs);
  const known: KnownRange[] = [];
  for (const [lo, hi, at] of type.known) {
    const run = revs.covering(at + 1);
    push(known, [lo, hi, run ? Math.max(at, run[1]) : at]);
  }
  // A cut is spent once something at or above it is known again.
  const cut = combine(type.cut ?? [], known, (c, k) =>
    c !== undefined && (k === undefined || k < c) ? c : undefined,
  );
  return { revs: revs.toJSON(), known, ...(cut.length ? { cut } : {}) };
}

interface DraftType {
  revs: IntervalSet;
  known: KnownRange[];
  cut: KnownRange[];
}

class Draft {
  readonly rows: Map<string, Row>;
  revs: IntervalSet;
  readonly types = new Map<string, DraftType>();
  constructor(
    replica: Replica,
    private readonly windowed: WindowedTypes,
  ) {
    this.rows = new Map(replica.rows);
    this.revs = new IntervalSet(replica.coverage.revs);
    for (const [type, value] of Object.entries(replica.coverage.types))
      this.types.set(type, {
        revs: new IntervalSet(value.revs),
        known: value.known.slice(),
        cut: (value.cut ?? []).slice(),
      });
  }
  type(type: string): DraftType {
    let value = this.types.get(type);
    if (!value) {
      value = { revs: new IntervalSet(), known: [], cut: [] };
      this.types.set(type, value);
    }
    return value;
  }
  seq(row: Row): number | undefined {
    const config = own(this.windowed, row.type);
    if (!config) return undefined;
    const seq = config.seqOf(row);
    integer(seq, "row sequence");
    return seq;
  }
  /** Stores the row if it wins and records it as known at `at` (by default its own revision). */
  row(row: Row, at = row.rev): void {
    const seq = this.seq(row);
    const key = rowKey(row.type, row.id);
    if (seq !== undefined && (atOf(this.type(row.type).cut, seq) ?? -1) > at)
      return;
    if (wins(this.rows.get(key), row, seq !== undefined))
      this.rows.set(key, row);
    if (seq !== undefined) this.know(row.type, seq, seq, at);
  }
  know(type: string, lo: number, hi: number, at: number): void {
    const value = this.type(type);
    const fact = combine([[lo, hi, at]], value.cut, (f, c) =>
      f !== undefined && (c === undefined || f >= c) ? f : undefined,
    );
    value.known = combine(value.known, fact, max);
  }
  /** Forgets a held row; facts about its sequence below what was known are void. */
  evict(type: string, id: string): void {
    const key = rowKey(type, id);
    const held = this.rows.get(key);
    if (!held) return;
    this.rows.delete(key);
    const seq = this.seq(held)!;
    const value = this.type(type);
    const revs = value.revs.toJSON();
    const floor = Math.max(
      held.rev,
      atOf(value.known, seq) ?? -1,
      revs.length ? revs[revs.length - 1]![1] : -1,
    );
    value.known = removeKnown(value.known, seq, seq);
    value.cut = combine(value.cut, [[seq, seq, floor]], max);
  }
  finish(): Replica {
    const types: Record<string, TypeCoverage> = {};
    for (const type of [...this.types.keys()].sort()) {
      const value = this.types.get(type)!;
      const closed = close({
        revs: value.revs.toJSON(),
        known: value.known,
        cut: value.cut,
      });
      if (closed.revs.length || closed.known.length || closed.cut)
        types[type] = closed;
    }
    return {
      coverage: { revs: this.revs.toJSON(), types },
      rows: this.rows,
    };
  }
}

function checkChain(from: number, pages: readonly ScopePull[]): void {
  integer(from, "chain base");
  valid(pages.length > 0, "Empty chain");
  let previous = 0;
  pages.forEach((page, index) => {
    integer(page.cursor, "pull cursor");
    valid(page.cursor >= previous, "Pull cursor moved backwards");
    valid(index === pages.length - 1 || page.more, "Page after completed pull");
    for (const row of page.rows) {
      checkRow(row);
      valid(row.rev <= page.cursor, "Row exceeds page cursor");
    }
    for (const type of page.reset ?? [])
      valid(typeof type === "string" && type.length > 0, "Invalid reset type");
    previous = page.cursor;
  });
  valid(!pages[pages.length - 1]!.more, "Incomplete chain");
}

/**
 * The one merge for every inbound change of a scope replica. Pure: the result is a
 * new replica. Remote inputs are commutative, associative and idempotent.
 */
export function mergeReplica(
  replica: Replica,
  input: Inbound,
  windowed: WindowedTypes,
): Replica {
  if (input.kind === "purge") return EMPTY_REPLICA;
  const draft = new Draft(replica, windowed);
  switch (input.kind) {
    case "chain": {
      checkChain(input.from, input.pages);
      const top = input.pages[input.pages.length - 1]!.cursor;
      for (const page of input.pages)
        for (const row of page.rows) draft.row(row);
      if (input.from === 0) draft.revs = draft.revs.add(0);
      if (top > input.from) {
        draft.revs = draft.revs.add(input.from + 1, top);
        // Windowed rows travel only when the server says so, and a reset withholds
        // a type; either way that type's revisions stay unknown, never implied.
        const withheld = new Set<string>();
        for (const page of input.pages)
          for (const type of page.reset ?? []) withheld.add(type);
        if (input.pages.every((page) => page.windowed === true))
          for (const type of Object.keys(windowed))
            if (!withheld.has(type)) {
              const value = draft.type(type);
              value.revs = value.revs.add(input.from + 1, top);
            }
      }
      break;
    }
    case "page": {
      valid(own(windowed, input.type) !== undefined, "Page of a mirrored type");
      integer(input.rev, "page revision");
      integer(input.lo, "page lower bound");
      integer(input.hi, "page upper bound", input.lo - 1);
      for (const row of input.rows) {
        checkRow(row);
        valid(row.type === input.type, "Page contains another type");
        valid(row.rev <= input.rev, "Row exceeds page revision");
        const seq = draft.seq(row)!;
        valid(seq >= input.lo && seq <= input.hi, "Page row outside range");
        draft.row(row, input.rev);
      }
      if (input.lo <= input.hi)
        draft.know(input.type, input.lo, input.hi, input.rev);
      break;
    }
    case "rows":
      for (const row of input.rows) {
        checkRow(row);
        draft.row(row);
      }
      break;
    case "evict": {
      valid(
        own(windowed, input.type) !== undefined,
        "Evicting a mirrored type",
      );
      for (const id of input.ids) draft.evict(input.type, id);
      break;
    }
  }
  return draft.finish();
}
