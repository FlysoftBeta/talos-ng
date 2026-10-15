import { describe, expect, it } from "vitest";
import { compareStamp, encodeStamp, HybridClock } from "./clock.ts";
import { createUlid, isUlid, ulid, ulidTime } from "./ids.ts";
describe("ULID", () => {
  it("uses the canonical Crockford representation and extracts time", () => {
    const next = createUlid({ random: () => 0 });
    expect(next(0)).toBe("00000000000000000000000000");
    expect(next(1469918176385)).toBe("01ARYZ6S41" + "0".repeat(16));
    expect(ulidTime("01ARYZ6S41YYYYYYYYYYYYYYYY")).toBe(1469918176385);
    expect(createUlid({ random: () => 31 / 32 })(281474976710655)).toBe(
      "7ZZZZZZZZZZZZZZZZZZZZZZZZZ",
    );
    expect(isUlid(ulid())).toBe(true);
  });
  it("is strictly monotonic at equal/backwards times and carries randomness", () => {
    let time = 100;
    const next = createUlid({ clock: () => time, random: () => 0 });
    const values = Array.from({ length: 1000 }, () => next());
    time = 90;
    values.push(next());
    time = 101;
    values.push(next());
    for (let i = 1; i < values.length; i++)
      expect(values[i]! > values[i - 1]!).toBe(true);
    expect(values[32]!.endsWith("10")).toBe(true);
    expect(ulidTime(values[1000]!)).toBe(100);
  });
  it("validates inputs and preserves state on exhaustion or invalid randomness", () => {
    const next = createUlid({ random: () => 1 - Number.EPSILON });
    const last = next(1);
    expect(() => next(1)).toThrow();
    expect(() => next(1)).toThrow();
    expect(next(2) > last).toBe(true);
    for (const time of [-1, 1.5, NaN, Infinity, 281474976710656])
      expect(() => createUlid()(time)).toThrow();
    for (const sample of [-0.1, 1, NaN])
      expect(() => createUlid({ random: () => sample })(0)).toThrow();
    for (const invalid of [
      "",
      "8ZZZZZZZZZZZZZZZZZZZZZZZZZ",
      "01aryz6s41yyyyyyyyyyyyyyyy",
      "01ARYZ6S41IIIIIIIIIIIIIIII",
      123,
    ]) {
      expect(isUlid(invalid)).toBe(false);
      expect(() => ulidTime(invalid as string)).toThrow();
    }
  });
});
describe("hybrid logical clock", () => {
  it("advances on equal/rollback wall time and observes remote causality", () => {
    let wall = 100;
    const clock = new HybridClock(() => wall);
    expect(clock.now()).toEqual({ ms: 100, counter: 0 });
    expect(clock.now()).toEqual({ ms: 100, counter: 1 });
    wall = 10;
    expect(clock.now()).toEqual({ ms: 100, counter: 2 });
    expect(clock.observe({ ms: 500, counter: 10 })).toEqual({
      ms: 500,
      counter: 11,
    });
    expect(clock.observe({ ms: 500, counter: 5 })).toEqual({
      ms: 500,
      counter: 12,
    });
    expect(clock.observe({ ms: 1, counter: 100 })).toEqual({
      ms: 500,
      counter: 13,
    });
    wall = 501;
    const stamp = clock.now();
    expect(stamp).toEqual({ ms: 501, counter: 0 });
    Object.assign(stamp, { ms: 0 });
    expect(clock.now()).toEqual({ ms: 501, counter: 1 });
  });
  it("encodes sortable strings throughout safe integer range", () => {
    const stamps = [
      { ms: 0, counter: 0 },
      { ms: 0, counter: 1 },
      { ms: 1, counter: 0 },
      { ms: 100, counter: 1 },
      { ms: Number.MAX_SAFE_INTEGER, counter: Number.MAX_SAFE_INTEGER },
    ];
    expect(stamps.map(encodeStamp).sort()).toEqual(stamps.map(encodeStamp));
    expect(compareStamp(stamps[0]!, stamps[1]!)).toBe(-1);
    expect(compareStamp(stamps[1]!, stamps[0]!)).toBe(1);
    expect(compareStamp(stamps[1]!, stamps[1]!)).toBe(0);
  });
  it("rejects invalid stamps, clocks and counter overflow", () => {
    const clock = new HybridClock(() => 0);
    for (const ms of [-1, 0.1, NaN, Infinity]) {
      expect(() => clock.observe({ ms, counter: 0 })).toThrow();
      expect(() => new HybridClock(() => ms).now()).toThrow();
    }
    expect(() => encodeStamp({ ms: 0, counter: -1 })).toThrow();
    expect(() =>
      clock.observe({ ms: 1, counter: Number.MAX_SAFE_INTEGER }),
    ).toThrow();
    expect(clock.now()).toEqual({ ms: 0, counter: 1 });
  });
});
