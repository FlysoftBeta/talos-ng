import { describe, it, expect } from "vitest";
import { IncrementalBlocks } from "./blocks.ts";
describe("incremental Markdown blocks", () => {
  it("scans each appended character once for a 20k answer and preserves block references", () => {
    const parser = new IncrementalBlocks(),
      text =
        "中文解释\n\n```js\nconst n = 42;\n\nconsole.log(n);\n```\n\n公式 $x^2$\n\n"
          .repeat(400)
          .slice(0, 20000);
    let previous: readonly string[] = [];
    for (let i = 1; i <= text.length; i++) {
      const result = parser.update(text.slice(0, i));
      if (previous.length) expect(result.blocks[0]).toBe(previous[0]);
      previous = result.blocks.slice(0, 1);
    }
    const final = parser.update(text, true);
    expect(final.blocks.join("") + final.tail).toBe(text);
    expect(parser.scanned).toBe(20000);
  });
  it("does not split inside fenced code or display math and resets on replacement", () => {
    const p = new IncrementalBlocks();
    expect(p.update("```js\nline\n\n").blocks).toEqual([]);
    expect(p.update("```js\nline\n\n```\n\n").blocks).toHaveLength(1);
    expect(p.update("$$\nx\n\n").blocks).toEqual([]);
    expect(p.update("$$\nx\n\n$$\n\n").blocks).toHaveLength(1);
  });
});
