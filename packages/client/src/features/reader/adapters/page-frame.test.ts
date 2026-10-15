import { describe, expect, it } from "vitest";
import { sanitizePage } from "./page-frame.ts";
describe("opaque frame input", () => {
  it("removes executable author markup and external URLs, retaining validated resource slots", () => {
    const html = sanitizePage(
      '<html><head><script>alert(1)</script><link data-bundle-ref="css" href="x" rel="stylesheet"></head><body onload="bad()"><iframe src="https://evil.test"></iframe><img src="https://evil.test/x"><p onclick="bad()">中文</p></body></html>',
      new Map([["css", { mime: "text/css" }]]),
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("iframe,script,[onclick],[onload]")).toBeNull();
    expect(doc.querySelector("img")?.hasAttribute("src")).toBe(false);
    expect(doc.querySelector("link")?.getAttribute("href")).toBe("#");
    expect(doc.querySelector("meta")?.content).toContain("default-src 'none'");
  });
  it("rejects missing dependencies and script type substitution", () => {
    expect(() =>
      sanitizePage('<img data-bundle-ref="missing" src="x">', new Map()),
    ).toThrow();
    expect(() =>
      sanitizePage(
        '<script data-bundle-ref="x" src="x"></script>',
        new Map([["x", { mime: "image/png" }]]),
      ),
    ).toThrow();
  });
});
