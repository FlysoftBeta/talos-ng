import { AppError } from "@talos/base";
import { describe, expect, it } from "vitest";
import { random } from "../test/random.ts";
import { IntervalSet } from "./intervals.ts";

describe("IntervalSet", () => {
  it("canonicalizes unordered, overlapping, nested and adjacent intervals", () => {
    expect(
      new IntervalSet([
        [8, 10],
        [3, 5],
        [1, 2],
        [2, 4],
        [9, 9],
      ]).toJSON(),
    ).toEqual([
      [1, 5],
      [8, 10],
    ]);
    expect(
      new IntervalSet([
        [1, 5],
        [8, 10],
      ])
        .add(6, 7)
        .toJSON(),
    ).toEqual([[1, 10]]);
  });

  it.each([
    [0, 10, []],
    [
      4,
      6,
      [
        [1, 3],
        [7, 9],
      ],
    ],
    [0, 4, [[5, 9]]],
    [6, 10, [[1, 5]]],
    [10, 12, [[1, 9]]],
    [1, 9, []],
  ] as const)("removes [%s,%s]", (lo, hi, expected) => {
    expect(new IntervalSet([[1, 9]]).remove(lo, hi).toJSON()).toEqual(expected);
  });

  it("finds covering ranges, bounded gaps, head, and trims interval count", () => {
    const set = new IntervalSet([
      [1, 3],
      [5, 5],
      [8, 9],
    ]);
    expect(set.covering(3)).toEqual([1, 3]);
    expect(set.covering(4)).toBeUndefined();
    expect(set.gapsWithin(2, 11)).toEqual([
      [4, 4],
      [6, 7],
      [10, 11],
    ]);
    expect(set.head()).toEqual([8, 9]);
    expect(set.trimTo(2, "head").toJSON()).toEqual([
      [5, 5],
      [8, 9],
    ]);
    expect(set.trimTo(0).toJSON()).toEqual([]);
    expect(set.trimTo(10).toJSON()).toEqual(set.toJSON());
    expect(new IntervalSet().head()).toBeUndefined();
    expect(new IntervalSet().gapsWithin(-1, 1)).toEqual([[-1, 1]]);
  });

  it("copies all interval arrays on input and output", () => {
    const input: [number, number][] = [[1, 3]];
    const set = new IntervalSet(input);
    input[0]![0] = 0;
    const json = set.toJSON() as [number, number][];
    json[0]![1] = 100;
    const head = set.head() as [number, number];
    head[0] = -100;
    const covering = set.covering(2) as [number, number];
    covering[1] = 99;
    expect(set.toJSON()).toEqual([[1, 3]]);
    expect(set.add(4).toJSON()).toEqual([[1, 4]]);
    expect(set.toJSON()).toEqual([[1, 3]]);
    expect(
      IntervalSet.fromJSON(
        JSON.parse(JSON.stringify(set)) as [number, number][],
      ).toJSON(),
    ).toEqual([[1, 3]]);
  });

  it("handles safe-integer endpoints without arithmetic overflow", () => {
    const lo = Number.MIN_SAFE_INTEGER;
    const hi = Number.MAX_SAFE_INTEGER;
    const set = new IntervalSet([[lo, hi]]);
    expect(set.gapsWithin(lo, hi)).toEqual([]);
    expect(set.remove(lo, hi).toJSON()).toEqual([]);
    expect(set.remove(lo).remove(hi).toJSON()).toEqual([[lo + 1, hi - 1]]);
    expect(new IntervalSet([[hi, hi]]).gapsWithin(hi - 1, hi)).toEqual([
      [hi - 1, hi - 1],
    ]);
  });

  it.each([NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid endpoints (%s)",
    (value) => {
      expect(() => new IntervalSet([[value, value]])).toThrow(AppError);
      expect(() => new IntervalSet().contains(value)).toThrow(AppError);
    },
  );

  it("rejects reversed ranges and negative retention counts", () => {
    expect(() => new IntervalSet().add(2, 1)).toThrow(AppError);
    expect(() => new IntervalSet().remove(2, 1)).toThrow(AppError);
    expect(() => new IntervalSet().gapsWithin(2, 1)).toThrow(AppError);
    expect(() => new IntervalSet().trimTo(-1)).toThrow(AppError);
  });

  it("matches a naive bitset across 8000 seeded additions/removals and gap queries", () => {
    const rng = random(1402);
    let set = new IntervalSet();
    const model = new Set<number>();
    for (let step = 0; step < 8000; step++) {
      const a = rng(81) - 40;
      const b = rng(81) - 40;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const add = rng(2) === 0;
      set = add ? set.add(lo, hi) : set.remove(lo, hi);
      for (let n = lo; n <= hi; n++) {
        if (add) model.add(n);
        else model.delete(n);
      }
      const expanded: number[] = [];
      for (const [x, y] of set.toJSON())
        for (let n = x; n <= y; n++) expanded.push(n);
      expect(expanded).toEqual([...model].sort((x, y) => x - y));
      const query = rng(81) - 40;
      expect(set.contains(query)).toBe(model.has(query));
      const gaps = new IntervalSet(set.gapsWithin(lo, hi));
      for (let n = lo; n <= hi; n++)
        expect(gaps.contains(n)).toBe(!model.has(n));
      const intervals = set.toJSON();
      for (let i = 1; i < intervals.length; i++)
        expect(intervals[i]![0]).toBeGreaterThan(intervals[i - 1]![1] + 1);
    }
  });
});
