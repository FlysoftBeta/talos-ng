import { describe, expect, it } from "vitest";
import { VirtualListCore } from "./core";

function list(count = 100, stickToBottom = false): VirtualListCore<number> {
  const core = new VirtualListCore<number>({
    estimatedItemHeight: 20,
    overscan: 0,
    stickToBottom,
  });
  core.setItems(Array.from({ length: count }, (_, i) => i));
  core.setViewport(0, 100);
  return core;
}

describe("VirtualListCore", () => {
  it("supports an empty list", () => {
    const core = list(0);
    expect(core.range()).toEqual({ start: 0, end: 0, top: 0, total: 0 });
    expect(core.setViewport(500, 100)).toBe(0);
  });
  it("reports exact exclusive-end ranges", () => {
    const core = list();
    expect(core.range()).toEqual({ start: 0, end: 5, top: 0, total: 2000 });
    core.setViewport(11, 100);
    expect(core.range()).toEqual({ start: 0, end: 6, top: 0, total: 2000 });
  });
  it("overscans in pixels in both directions", () => {
    const core = list();
    core.setViewport(200, 100);
    expect(core.range(60)).toEqual({
      start: 7,
      end: 18,
      top: 140,
      total: 2000,
    });
  });
  it("clamps at both list boundaries", () => {
    const core = list(10);
    core.setViewport(500, 100);
    expect(core.offset).toBe(100);
    expect(core.range(1000)).toEqual({ start: 0, end: 10, top: 0, total: 200 });
  });
  it("measures variable rows and preserves the partially visible anchor", () => {
    const core = list();
    core.setViewport(205, 100);
    core.measure(0, 70);
    expect(core.offset).toBe(255);
    expect(core.range().start).toBe(10);
    core.measure(1, 10);
    expect(core.offset).toBe(245);
  });
  it("does not shift for measurements in or below the anchor", () => {
    const core = list();
    core.setViewport(205, 100);
    core.measure(10, 30);
    core.measure(50, 60);
    expect(core.offset).toBe(205);
  });
  it("preserves keyed anchor and measurements through prepend and reorder", () => {
    const core = list();
    core.setViewport(205, 100);
    core.measure(5, 30);
    core.setItems([-2, -1, ...Array.from({ length: 100 }, (_, i) => i)]);
    expect(core.offset).toBe(255);
    expect(core.range().start).toBe(12);
    expect(core.offsetOf(8) - core.offsetOf(7)).toBe(30);
    core.setItems(Array.from({ length: 100 }, (_, i) => 99 - i));
    expect(core.range().start).toBe(89);
    expect(core.offset - core.offsetOf(89)).toBe(5);
  });
  it("preserves the view when appending outside bottom-stick mode", () => {
    const core = list(10);
    core.setViewport(100, 100);
    core.setItems(Array.from({ length: 20 }, (_, i) => i));
    expect(core.offset).toBe(100);
  });
  it("pins chat appends, resize and measurements at bottom", () => {
    const core = list(10, true);
    core.scrollToIndex(9, "end");
    core.setItems(Array.from({ length: 20 }, (_, i) => i));
    expect(core.offset).toBe(300);
    core.measure(19, 40);
    expect(core.offset).toBe(320);
    core.setViewport(core.offset, 200);
    expect(core.offset).toBe(220);
  });
  it("does not pull a chat reader to the bottom after scrolling up", () => {
    const core = list(10, true);
    core.setViewport(20, 100);
    core.setItems(Array.from({ length: 20 }, (_, i) => i));
    expect(core.offset).toBe(20);
  });
  it("clamps an anchor removed by replacing the data", () => {
    const core = list();
    core.setViewport(500, 100);
    core.setItems([200, 201]);
    expect(core.offset).toBe(0);
  });
  it.each(["start", "center", "end"] as const)(
    "scrolls with %s alignment",
    (alignment) => {
      const core = list();
      expect(core.scrollToIndex(20, alignment)).toBe(
        { start: 400, center: 360, end: 320 }[alignment],
      );
      expect(core.scrollToKey(30, alignment)).toBe(
        { start: 600, center: 560, end: 520 }[alignment],
      );
    },
  );
  it("auto alignment moves only as far as needed", () => {
    const core = list();
    expect(core.scrollToIndex(2)).toBe(0);
    expect(core.scrollToIndex(5)).toBe(20);
    expect(core.scrollToIndex(0)).toBe(0);
    core.measure(20, 200);
    expect(core.scrollToIndex(20)).toBe(400);
  });
  it("handles fractional heights without rounding drift", () => {
    const core = list(10);
    core.measure(0, 20.25);
    core.measure(1, 20.5);
    expect(core.offsetOf(2)).toBe(40.75);
    expect(core.totalSize).toBe(200.75);
  });
  it("copies supplied keys and rejects duplicate keys atomically", () => {
    const core = list();
    const keys = [1, 2];
    core.setItems(keys);
    keys.push(3);
    expect(core.count).toBe(2);
    expect(() => core.setItems([1, 1])).toThrow("列表键");
    expect(core.count).toBe(2);
  });
  it.each([0, -1, NaN, Infinity])("rejects invalid height %s", (height) => {
    expect(
      () => new VirtualListCore({ estimatedItemHeight: height }),
    ).toThrow();
    expect(() => list().measure(0, height)).toThrow();
  });
  it.each([-1, NaN, Infinity])("rejects invalid distance %s", (value) => {
    expect(() => list().range(value)).toThrow();
    expect(() => list().setViewport(value, 100)).toThrow();
    expect(() => list().setViewport(0, value)).toThrow();
  });
  it.each([-1, 100, 1.5, NaN])("rejects invalid index %s", (index) => {
    expect(() => list().measure(index, 20)).toThrow();
    expect(() => list().scrollToIndex(index)).toThrow();
    expect(() => list().offsetOf(index)).toThrow();
  });
  it("rejects missing keys and nonfinite numeric keys", () => {
    expect(() => list().scrollToKey(200)).toThrow("不存在");
    expect(() => list().setItems([NaN])).toThrow("列表键");
  });
  it("indexes 100,000 rows with only a small visible range", () => {
    const core = list(100_000);
    core.scrollToIndex(50_000, "start");
    expect(core.range()).toEqual({
      start: 50_000,
      end: 50_005,
      top: 1_000_000,
      total: 2_000_000,
    });
    core.measure(0, 30);
    expect(core.range().start).toBe(50_000);
  });
  it("matches a linear reference across 2,000 deterministic random measurements and scrolls", () => {
    const core = list(200);
    const heights = new Array<number>(200).fill(20);
    let seed = 19217;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let iteration = 0; iteration < 2000; iteration++) {
      const index = Math.floor(random() * heights.length);
      const height = 1 + Math.floor(random() * 150);
      heights[index] = height;
      core.measure(index, height);
      const total = heights.reduce((a, b) => a + b, 0);
      const offset = Math.floor(random() * total);
      core.setViewport(offset, 100);
      expect(core.totalSize).toBe(total);
      expect(core.offsetOf(index)).toBe(
        heights.slice(0, index).reduce((a, b) => a + b, 0),
      );
      const range = core.range();
      expect(range.top).toBeLessThanOrEqual(core.offset);
      expect(range.top + heights[range.start]!).toBeGreaterThan(core.offset);
      expect(range.end).toBeGreaterThan(range.start);
      expect(range.end).toBeLessThanOrEqual(200);
    }
  });
});
