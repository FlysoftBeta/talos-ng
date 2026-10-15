import { AppError, createUlid } from "@talos/base";
import { describe, expect, it } from "vitest";
import { random } from "../test/random.ts";
import {
  clampFutureStamp,
  lwwMerge,
  lwwSet,
  maxMerge,
  mergeImmutable,
} from "./registers.ts";
import type { Lww } from "./registers.ts";

const id = createUlid({ clock: () => 0, random: () => 0 });
const op1 = id();
const op2 = id();
describe("registers", () => {
  it("orders LWW by wall time, logical counter, then operation id", () => {
    const values = [
      lwwSet(undefined, "a", { ms: 0, counter: 0 }, op1),
      lwwSet(undefined, "b", { ms: 0, counter: 0 }, op2),
      lwwSet(undefined, "c", { ms: 0, counter: 1 }, op1),
      lwwSet(undefined, "d", { ms: 1, counter: 0 }, op1),
    ];
    for (let i = 0; i < values.length; i++)
      for (let j = i; j < values.length; j++) {
        expect(lwwMerge(values[i]!, values[j]!)).toBe(values[j]);
        expect(lwwMerge(values[j]!, values[i]!)).toBe(values[j]);
      }
  });

  it("sets through merge and copies the input stamp", () => {
    const stamp = { ms: 10, counter: 1 };
    const initial = lwwSet(undefined, "new", stamp, op1);
    stamp.ms = 0;
    expect(initial.t.ms).toBe(10);
    expect(lwwSet(initial, "old", stamp, op2)).toBe(initial);
  });

  it("satisfies LWW commutativity, associativity and idempotence for 4000 seeded triples", () => {
    const rng = random(14);
    const pool: Lww<number>[] = Array.from({ length: 80 }, (_, v) => ({
      v,
      t: { ms: rng(8), counter: rng(4) },
      op: id(),
    }));
    for (let i = 0; i < 4000; i++) {
      const a = pool[rng(pool.length)]!;
      const b = pool[rng(pool.length)]!;
      const c = pool[rng(pool.length)]!;
      expect(lwwMerge(a, b)).toEqual(lwwMerge(b, a));
      expect(lwwMerge(lwwMerge(a, b), c)).toEqual(lwwMerge(a, lwwMerge(b, c)));
      expect(lwwMerge(a, a)).toBe(a);
    }
  });

  it("satisfies numeric and cursor Max laws, including ties", () => {
    const rng = random(21);
    for (let i = 0; i < 1000; i++) {
      const a = rng(50);
      const b = rng(50);
      const c = rng(50);
      expect(maxMerge(a, b)).toBe(maxMerge(b, a));
      expect(maxMerge(maxMerge(a, b), c)).toBe(maxMerge(a, maxMerge(b, c)));
      expect(maxMerge(a, a)).toBe(a);
      const x = { seq: a, id: String(rng(20)) };
      const y = { seq: b, id: String(rng(20)) };
      const z = { seq: c, id: String(rng(20)) };
      expect(maxMerge(x, y)).toEqual(maxMerge(y, x));
      expect(maxMerge(maxMerge(x, y), z)).toEqual(maxMerge(x, maxMerge(y, z)));
      expect(maxMerge(x, x)).toBe(x);
    }
    expect(maxMerge({ seq: 1, id: "a" }, { seq: 1, id: "b" })).toEqual({
      seq: 1,
      id: "b",
    });
    expect(maxMerge(-1.5, -2)).toBe(-1.5);
  });

  it("never resurrects an immutable fact even with a higher content revision", () => {
    const dead = { rev: 1, deleted: true, data: null };
    const live = { rev: 100, deleted: false, data: "x" };
    expect(mergeImmutable(dead, live)).toBe(dead);
    expect(mergeImmutable(live, dead)).toBe(dead);
    expect(mergeImmutable(dead, { ...dead, rev: 2 }).rev).toBe(2);
    expect(mergeImmutable(live, { ...live, rev: 101 }).rev).toBe(101);
  });

  it("satisfies immutable merge laws for seeded tombstone histories", () => {
    const rng = random(20);
    const pool = Array.from({ length: 50 }, (_, rev) => ({
      rev,
      deleted: rng(2) === 0,
      data: rev,
    }));
    for (let i = 0; i < 1000; i++) {
      const a = pool[rng(50)]!;
      const b = pool[rng(50)]!;
      const c = pool[rng(50)]!;
      expect(mergeImmutable(a, b)).toEqual(mergeImmutable(b, a));
      expect(mergeImmutable(mergeImmutable(a, b), c)).toEqual(
        mergeImmutable(a, mergeImmutable(b, c)),
      );
      expect(mergeImmutable(a, a)).toBe(a);
    }
  });

  it("clamps future stamps, resets their counter and preserves stamps at the boundary", () => {
    expect(clampFutureStamp({ ms: 151, counter: 999 }, 100, 50)).toEqual({
      stamp: { ms: 150, counter: 0 },
      clamped: true,
    });
    expect(clampFutureStamp({ ms: 150, counter: 999 }, 100, 50)).toEqual({
      stamp: { ms: 150, counter: 999 },
      clamped: false,
    });
    expect(clampFutureStamp({ ms: 0, counter: 0 }, 100, 0).clamped).toBe(false);
    expect(
      clampFutureStamp(
        { ms: Number.MAX_SAFE_INTEGER, counter: 0 },
        Number.MAX_SAFE_INTEGER,
        100,
      ).clamped,
    ).toBe(false);
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid stamps/revisions (%s) as AppError",
    (value) => {
      expect(() =>
        lwwSet(undefined, 0, { ms: value, counter: 0 }, op1),
      ).toThrow(AppError);
      expect(() => clampFutureStamp({ ms: 0, counter: value }, 0, 0)).toThrow(
        AppError,
      );
      expect(() => clampFutureStamp({ ms: 0, counter: 0 }, value, 0)).toThrow(
        AppError,
      );
      expect(() =>
        mergeImmutable(
          { rev: value, deleted: false },
          { rev: 0, deleted: true },
        ),
      ).toThrow(AppError);
      expect(() =>
        maxMerge({ seq: value, id: "x" }, { seq: 0, id: "y" }),
      ).toThrow(AppError);
    },
  );

  it("rejects invalid operation identifiers and non-finite Max values", () => {
    expect(() => lwwSet(undefined, 0, { ms: 0, counter: 0 }, "bad")).toThrow(
      AppError,
    );
    expect(() => maxMerge(NaN, 1)).toThrow(AppError);
    expect(() => maxMerge(1, Infinity)).toThrow(AppError);
  });
});
