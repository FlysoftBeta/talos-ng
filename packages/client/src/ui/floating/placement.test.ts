import { describe, it, expect } from "vitest";
import { placeFloating } from "./placement.ts";

describe("floating viewport placement", () => {
  it("flips above a bottom-edge anchor and clamps right alignment at the left edge", () => {
    expect(
      placeFloating(
        { left: 0, right: 40, top: 440, bottom: 480 },
        240,
        200,
        { width: 600, height: 500 },
        "end",
      ),
    ).toEqual({ left: 8, top: 236, maxHeight: 320 });
  });
  it("uses the larger side and caps a tall scrollable surface", () => {
    expect(
      placeFloating(
        { left: 270, right: 310, top: 150, bottom: 190 },
        240,
        1000,
        { width: 320, height: 400 },
      ),
    ).toEqual({ left: 72, top: 194, maxHeight: 198 });
  });
  it("keeps constrained surfaces inside the viewport across 3000 seeded geometries", () => {
    let seed = 4261;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 3000; i++) {
      const viewport = {
        width: 80 + random() * 1300,
        height: 80 + random() * 1000,
      };
      const left = random() * (viewport.width - 40),
        top = random() * (viewport.height - 40);
      const width = Math.min(240, viewport.width - 16),
        height = random() * 1800;
      const p = placeFloating(
        { left, right: left + 40, top, bottom: top + 40 },
        width,
        height,
        viewport,
        ["start", "end", "center"][i % 3] as "start" | "end" | "center",
      );
      expect(p.left).toBeGreaterThanOrEqual(8);
      expect(p.left + width).toBeLessThanOrEqual(viewport.width - 8 + 0.001);
      expect(p.top).toBeGreaterThanOrEqual(8);
      expect(p.top + Math.min(height, p.maxHeight)).toBeLessThanOrEqual(
        viewport.height - 8 + 0.001,
      );
      expect(p.maxHeight).toBeGreaterThanOrEqual(0);
    }
  });
});
