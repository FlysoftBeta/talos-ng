import { describe, expect, it } from "vitest";
import {
  HALF_LIFE_MS,
  MIN_VISIT_GAP_MS,
  pruneHistory,
  scoreAt,
  selectFrecent,
  selectFrequent,
  selectRecent,
  visit,
} from "./frecency.ts";
import type { Frecency, Ranked } from "./frecency.ts";

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;
const item = (key: string, score: number, at: number): Ranked => ({
  key,
  entry: { score, at },
});

describe("visit and scoreAt", () => {
  it("starts at 1 and halves per half-life", () => {
    const first = visit(undefined, T0);
    expect(first).toEqual({ score: 1, at: T0 });
    expect(scoreAt(first, T0 + HALF_LIFE_MS)).toBeCloseTo(0.5, 10);
    expect(scoreAt(first, T0 + 3 * HALF_LIFE_MS)).toBeCloseTo(0.125, 10);
  });

  it("accumulates frequency with decay between visits", () => {
    let e: Frecency | undefined;
    for (let i = 0; i < 5; i++) e = visit(e, T0 + i * DAY);
    const once = visit(undefined, T0 + 4 * DAY);
    expect(e!.score).toBeGreaterThan(once.score * 3);
    expect(e!.score).toBeLessThan(5);
    expect(e!.at).toBe(T0 + 4 * DAY);
  });

  it("counts a visit after one half-life as old/2 + 1", () => {
    const e = visit(visit(visit(undefined, T0), T0 + DAY), T0 + 2 * DAY);
    const next = visit(e, e.at + HALF_LIFE_MS);
    expect(next.score).toBeCloseTo(e.score / 2 + 1, 2);
  });

  it("ignores repeat visits inside the minimum gap", () => {
    const first = visit(undefined, T0);
    expect(visit(first, T0 + MIN_VISIT_GAP_MS - 1)).toBe(first);
    expect(visit(first, T0 + MIN_VISIT_GAP_MS).score).toBeGreaterThan(1);
  });

  it("does not inflate or move time backwards when the clock runs back", () => {
    const e = { score: 3, at: T0 };
    expect(scoreAt(e, T0 - DAY)).toBe(3);
    const back = visit(e, T0 - DAY);
    expect(back.at).toBe(T0);
    expect(back.score).toBeCloseTo(4, 2);
  });
});

describe("selectFrecent", () => {
  it("orders by decayed score: frequent-then-stale loses to fresh-and-often", () => {
    const items = [
      item("stale", 6, T0 - 5 * HALF_LIFE_MS),
      item("fresh", 2, T0),
      item("once", 1, T0),
    ];
    expect(selectFrecent(items, T0)).toEqual(["fresh", "once"]);
  });

  it("cuts relative to the top score, so the length varies", () => {
    const strong = [
      item("a", 20, T0),
      item("b", 12, T0),
      item("c", 6, T0),
      item("d", 1, T0),
    ];
    expect(selectFrecent(strong, T0)).toEqual(["a", "b", "c"]);
    const weak = [
      item("a", 1, T0),
      item("b", 0.9, T0),
      item("c", 0.5, T0),
      item("d", 0.2, T0),
    ];
    expect(selectFrecent(weak, T0)).toEqual(["a", "b", "c"]);
  });

  it("applies the absolute floor even when only one item exists", () => {
    expect(selectFrecent([item("a", 1, T0)], T0)).toEqual(["a"]);
    expect(selectFrecent([item("a", 1, T0 - 4 * HALF_LIFE_MS)], T0)).toEqual(
      [],
    );
    expect(selectFrecent([], T0)).toEqual([]);
  });

  it("caps the length", () => {
    const items = Array.from({ length: 30 }, (_, i) => item(`k${i}`, 5, T0));
    expect(selectFrecent(items, T0)).toHaveLength(8);
    expect(selectFrecent(items, T0, { max: 3 })).toHaveLength(3);
    expect(selectFrecent(items, T0, { max: 0 })).toEqual([]);
  });

  it("breaks ties by recency then key, deterministically", () => {
    const items = [item("b", 2, T0), item("a", 2, T0), item("c", 2, T0 + 1)];
    expect(selectFrecent(items, T0 + 2, { halfLifeMs: Infinity })).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("drops non-finite scores instead of poisoning the order", () => {
    const items = [item("bad", Number.NaN, T0), item("ok", 1, T0)];
    expect(selectFrecent(items, T0)).toEqual(["ok"]);
  });
});

describe("selectRecent", () => {
  it("orders by last access and drops what is too old", () => {
    const items = [
      item("old", 9, T0 - 30 * DAY),
      item("b", 1, T0 - DAY),
      item("a", 1, T0 - 2 * DAY),
      item("c", 1, T0),
    ];
    expect(selectRecent(items, T0)).toEqual(["c", "b", "a"]);
  });

  it("honours max and a custom age", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      item(`k${i}`, 1, T0 - i * DAY),
    );
    expect(selectRecent(items, T0)).toHaveLength(6);
    expect(selectRecent(items, T0, { max: 2 })).toEqual(["k0", "k1"]);
    expect(selectRecent(items, T0, { maxAgeMs: 2.5 * DAY })).toEqual([
      "k0",
      "k1",
      "k2",
    ]);
  });
});

describe("selectFrequent", () => {
  it("needs repeated visits and skips what the recent list shows", () => {
    const items = [
      item("often", 6, T0 - DAY),
      item("also", 4, T0 - 2 * DAY),
      item("twice-ish", 1.5, T0),
      item("once", 1, T0),
    ];
    expect(selectFrequent(items, T0)).toEqual(["often", "also"]);
    expect(selectFrequent(items, T0, ["often"])).toEqual(["also"]);
  });

  it("can be empty when nothing has been visited often", () => {
    expect(selectFrequent([item("a", 1, T0), item("b", 1, T0)], T0)).toEqual(
      [],
    );
  });
});

describe("pruneHistory", () => {
  it("keeps the highest-frecency entries within the bound", () => {
    const history = {
      a: { score: 1, at: T0 },
      b: { score: 5, at: T0 },
      c: { score: 9, at: T0 - 6 * HALF_LIFE_MS },
      d: { score: 1, at: T0 + 5 },
    };
    expect(Object.keys(pruneHistory(history, 2, T0)).sort()).toEqual([
      "b",
      "d",
    ]);
    expect(Object.keys(pruneHistory(history, 10, T0))).toHaveLength(4);
    expect(pruneHistory(history, 0, T0)).toEqual({});
  });
});
