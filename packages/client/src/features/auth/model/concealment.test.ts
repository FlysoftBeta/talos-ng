import { describe, expect, it } from "vitest";
import {
  ConcealmentSequence,
  keyDirection,
  tapDirection,
  UNLOCK_SEQUENCE,
} from "./concealment.ts";
import type { Direction } from "./concealment.ts";
describe("concealed admission sequence", () => {
  it("uses exact legacy zones, including neutral centre and 0.33/0.67 boundaries", () => {
    expect(tapDirection(50, 32, 100, 100)).toBe("U");
    expect(tapDirection(50, 68, 100, 100)).toBe("D");
    expect(tapDirection(32, 50, 100, 100)).toBe("L");
    expect(tapDirection(68, 50, 100, 100)).toBe("R");
    expect(tapDirection(50, 33, 100, 100)).toBeNull();
    expect(tapDirection(50, 67, 100, 100)).toBeNull();
  });
  it("arrows and either case of WASD have identical meaning", () => {
    expect(
      [
        "ArrowUp",
        "W",
        "w",
        "ArrowDown",
        "S",
        "s",
        "ArrowLeft",
        "A",
        "a",
        "ArrowRight",
        "D",
        "d",
      ].map(keyDirection),
    ).toEqual(["U", "U", "U", "D", "D", "D", "L", "L", "L", "R", "R", "R"]);
    expect(keyDirection("Enter")).toBeUndefined();
  });
  it("suppresses synthetic mouse until exactly 700ms and never advances it", () => {
    let now = 0;
    const state = new ConcealmentSequence(() => now);
    state.touch("U");
    now = 699;
    state.mouse("L");
    now = 700;
    expect(state.mouse("U")).toBe(false);
    expect(
      UNLOCK_SEQUENCE.slice(2).map((direction) => state.input(direction)),
    ).toEqual([false, false, false, false, false, true]);
  });
  it("matches the non-overlapping reset machine for deterministic random streams", () => {
    let seed = 123456;
    const input: (Direction | null)[] = ["U", "D", "L", "R", null];
    const machine = new ConcealmentSequence();
    let expectedProgress = 0;
    for (let i = 0; i < 20000; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const direction =
        i % 31 < 8 ? UNLOCK_SEQUENCE[i % 31]! : input[seed % input.length]!;
      expectedProgress =
        direction === UNLOCK_SEQUENCE[expectedProgress]
          ? expectedProgress + 1
          : 0;
      const revealed = expectedProgress === 8;
      if (revealed) expectedProgress = 0;
      expect(machine.input(direction)).toBe(revealed);
    }
  });
});
