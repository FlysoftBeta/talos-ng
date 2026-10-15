import { describe, expect, it, vi } from "vitest";
import { characterAt, characterTop } from "./anchor.ts";
describe("character anchors across reflow", () => {
  it("restores the same character at two widths and migrates a legacy pixel offset", () => {
    const element = document.createElement("div");
    element.textContent = "中文 abc ".repeat(1000);
    let columns = 40;
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      top: 0,
    } as DOMRect);
    vi.spyOn(document, "createRange").mockImplementation(() => {
      let offset = 0;
      return {
        setStart: (_node: Node, value: number) => {
          offset = value;
        },
        setEnd: () => {},
        getBoundingClientRect: () => ({
          top: Math.floor(offset / columns) * 24,
        }),
      } as unknown as Range;
    });
    try {
      const anchor = characterAt(element, 240);
      expect(anchor).toBe(400);
      expect(characterTop(element, anchor)).toBe(240);
      columns = 20;
      expect(characterTop(element, anchor)).toBe(480);
      expect(characterAt(element, 480)).toBe(anchor);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
