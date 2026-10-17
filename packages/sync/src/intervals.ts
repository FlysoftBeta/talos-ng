import { integer, valid } from "./validate.ts";

export type Interval = readonly [lo: number, hi: number];
export type IntervalSetJSON = readonly Interval[];

function range(lo: number, hi: number): void {
  integer(lo, "interval lower bound", Number.MIN_SAFE_INTEGER);
  integer(hi, "interval upper bound", Number.MIN_SAFE_INTEGER);
  valid(lo <= hi, "Interval lower bound exceeds upper bound");
}

/** Immutable canonical union of closed safe-integer ranges. */
export class IntervalSet {
  private readonly intervals: IntervalSetJSON;

  constructor(intervals: IntervalSetJSON = []) {
    const sorted = intervals
      .map(([lo, hi]): Interval => {
        range(lo, hi);
        return [lo, hi];
      })
      .sort((a, b) => a[0] - b[0]);
    const merged: Interval[] = [];
    for (const [lo, hi] of sorted) {
      const last = merged[merged.length - 1];
      if (last && lo <= last[1] + 1)
        merged[merged.length - 1] = [last[0], Math.max(last[1], hi)];
      else merged.push([lo, hi]);
    }
    this.intervals = merged;
  }

  static fromJSON(value: IntervalSetJSON): IntervalSet {
    return new IntervalSet(value);
  }

  toJSON(): IntervalSetJSON {
    return this.intervals.map(([lo, hi]) => [lo, hi]);
  }

  add(lo: number, hi = lo): IntervalSet {
    range(lo, hi);
    return new IntervalSet([...this.intervals, [lo, hi]]);
  }

  remove(lo: number, hi = lo): IntervalSet {
    range(lo, hi);
    const remaining: Interval[] = [];
    for (const [a, b] of this.intervals) {
      if (b < lo || a > hi) remaining.push([a, b]);
      else {
        if (a < lo) remaining.push([a, lo - 1]);
        if (b > hi) remaining.push([hi + 1, b]);
      }
    }
    return new IntervalSet(remaining);
  }

  contains(n: number): boolean {
    return this.covering(n) !== undefined;
  }

  covering(n: number): Interval | undefined {
    integer(n, "point", Number.MIN_SAFE_INTEGER);
    let lo = 0;
    let hi = this.intervals.length - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const interval = this.intervals[mid]!;
      if (n < interval[0]) hi = mid - 1;
      else if (n > interval[1]) lo = mid + 1;
      else return [interval[0], interval[1]];
    }
    return undefined;
  }

  gapsWithin(lo: number, hi: number): IntervalSetJSON {
    range(lo, hi);
    const gaps: Interval[] = [];
    let next = lo;
    for (const [a, b] of this.intervals) {
      if (b < next) continue;
      if (a > hi) break;
      if (a > next) gaps.push([next, a - 1]);
      if (b >= hi) return gaps;
      next = b + 1;
    }
    if (next <= hi) gaps.push([next, hi]);
    return gaps;
  }
}
