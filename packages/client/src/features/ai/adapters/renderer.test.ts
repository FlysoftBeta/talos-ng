import { describe, it, expect } from "vitest";
import "./renderer-entry.ts";
describe("offline safe rich rendering", () => {
  it("renders Chinese, fenced code, tables, inline math and labelled Mermaid source", () => {
    const html = window.__talosAiRenderer!.render(
      "中文 **学习**\n\n```js\nconst answer=42;\n```\n\n| 项目 | 内容 |\n| --- | --- |\n| 甲 | 乙 |\n\n公式 $\\frac{1}{2}+x^2$\n\n```mermaid\ngraph LR\nA-->B\n```",
    );
    expect(html).toContain("<strong>学习</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain("katex");
    expect(html).toContain("Mermaid 图表源码（兼容模式）");
    expect(html).toContain("const answer=42;");
  });
  it("escapes HTML, denies javascript links, remote image fetches and trusted TeX commands", () => {
    const html = window.__talosAiRenderer!.render(
      "<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![remote](https://external.test/a.png)\n\n$\\href{javascript:alert(1)}{x}$",
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript:');
  });
  it("allows explicit HTTPS links for the confirmation UI", () => {
    expect(
      window.__talosAiRenderer!.render("[资料](https://example.test/)"),
    ).toContain('href="https://example.test/"');
  });
});
