import { describe, expect, it } from "vitest";
import { ReadingClock } from "./clock.ts";
import { estimateUnit } from "./resources.ts";
describe("bounded reader and visible time", () => {
  it("counts only active intervals including final partial heartbeat", () => {
    let now = 0;
    const clock = new ReadingClock(() => now, 7);
    clock.setActive(true);
    now = 9000;
    expect(clock.seconds()).toBe(16);
    clock.setActive(false);
    now = 999000;
    expect(clock.seconds()).toBe(16);
    clock.setActive(true);
    now += 2500;
    clock.setActive(false);
    expect(clock.seconds()).toBe(18);
  });
  it("never counts a backwards clock delta", () => {
    let now = 100;
    const clock = new ReadingClock(() => now);
    clock.setActive(true);
    now = 0;
    clock.setActive(false);
    expect(clock.seconds()).toBe(0);
  });
  it("keeps long text units progressive and measures page zoom", () => {
    const base = {
      v: 1 as const,
      kind: "flow" as const,
      meta: {},
      units: [],
      shared: [],
      resources: {},
    };
    const unit = {
      ordinal: 0,
      id: "a",
      entry: "a",
      deps: [],
      chars: 8000,
      w: 600,
      h: 800,
    };
    expect(estimateUnit(base, unit, 700, "fit")).toBeGreaterThan(1000);
    expect(estimateUnit({ ...base, kind: "paged" }, unit, 700, "1.5")).toBe(
      1224,
    );
  });
});
