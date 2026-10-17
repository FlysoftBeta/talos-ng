import { describe, expect, it } from "vitest";
import { selectFrecent } from "./frecency.ts";
import type { Ranked } from "./frecency.ts";
import { unreadBoost } from "./unread.ts";

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;
const item = (key: string, score: number): Ranked => ({
  key,
  entry: { score, at: T0 },
});

describe("unread boost in the frecent ranking", () => {
  it("lifts a frequently used conversation above a similar one", () => {
    const items = [item("a", 5), item("b", 4.5)];
    expect(selectFrecent(items, T0)).toEqual(["a", "b"]);
    const lifted = selectFrecent(
      items,
      T0,
      {},
      { b: { count: 8, newestAt: T0 } },
    );
    expect(lifted).toEqual(["b", "a"]);
  });

  it("barely moves a conversation that is hardly ever opened", () => {
    const items = [item("often", 6), item("rare", 0.5), item("other", 3)];
    const order = selectFrecent(
      items,
      T0,
      { minScore: 0, relative: 0 },
      { rare: { count: 50, newestAt: T0 } },
    );
    expect(order).toEqual(["often", "other", "rare"]);
    expect(unreadBoost(0.5, 6, { count: 50, newestAt: T0 }, T0)).toBeLessThan(
      0.05,
    );
  });

  it("never exceeds half the item's own score and ignores empty signals", () => {
    const signal = { count: 1000, newestAt: T0 };
    expect(unreadBoost(4, 4, signal, T0)).toBeLessThanOrEqual(2);
    expect(unreadBoost(4, 4, { count: 0, newestAt: T0 }, T0)).toBe(0);
    expect(unreadBoost(4, 4, undefined, T0)).toBe(0);
  });

  it("fades as the newest unread message ages", () => {
    const at = (age: number) =>
      unreadBoost(4, 4, { count: 5, newestAt: T0 }, T0 + age);
    expect(at(DAY)).toBeCloseTo(at(0) / 2, 10);
    expect(at(7 * DAY)).toBeLessThan(at(0) / 100);
    const items = [item("a", 5), item("b", 4.5)];
    const sig = { b: { count: 8, newestAt: T0 } };
    expect(selectFrecent(items, T0, {}, sig)[0]).toBe("b");
    expect(selectFrecent(items, T0 + 3 * DAY, {}, sig)[0]).toBe("a");
  });
});
