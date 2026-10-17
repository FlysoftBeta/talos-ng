import { afterEach, describe, expect, it, vi } from "vitest";
import { mountPage } from "./mount.ts";
import { sanitizePage } from "./sanitize.ts";

/** Shape of a pdfrender page: an image defined once in `<defs>` and drawn through `<use>`. */
const PAGE =
  '<main class="page" style="width:40px;height:40px"><div class="background"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
  '<defs><image id="p1-0" xlink:href="img" data-bundle-ref="img" data-bundle-mime="image/webp"/></defs>' +
  '<use xlink:href="#p1-0" transform="scale(2)"/></svg></div>' +
  '<p class="paragraph" onclick="bad()">中文</p></main>';
const image = new Map([["img", { mime: "image/webp" }]]);

describe("page sanitising", () => {
  it("keeps the SVG use reference that draws a bundled image and fills the image slot", () => {
    const page = sanitizePage(PAGE, image);
    expect(page.querySelector("use")?.getAttribute("xlink:href")).toBe("#p1-0");
    expect(page.querySelector("image")?.getAttribute("xlink:href")).toBe("#");
    expect(page.querySelector("[onclick]")).toBeNull();
  });
  it("accepts a format-1 document and drops scripts, links, frames and external URLs", () => {
    const page = sanitizePage(
      `<!doctype html><html><head><link data-bundle-ref="css" href="css" rel="stylesheet"><script data-bundle-ref="js" src="js"></script></head><body>${PAGE.replace("<p ", '<iframe src="https://evil.test"></iframe><a href="https://evil.test">x</a><p ')}</body></html>`,
      image,
    );
    expect(
      page.querySelector("iframe,script,link")?.tagName ?? null,
    ).toBeNull();
    expect(page.querySelector("a")?.hasAttribute("href")).toBe(false);
  });
  it("rejects missing or wrongly typed bundle resources", () => {
    expect(() => sanitizePage(PAGE, new Map())).toThrow();
    expect(() =>
      sanitizePage(PAGE, new Map([["img", { mime: "text/javascript" }]])),
    ).toThrow();
  });
});

describe("shadow root mounting", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("resolves images to blob URLs inside the shadow root, scopes css, and revokes on dispose", () => {
    const revoked: string[] = [];
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: () => "blob:test/1",
        revokeObjectURL: (url: string) => revoked.push(url),
      }),
    );
    const host = document.createElement("div");
    document.body.appendChild(host);
    const dispose = mountPage(host, PAGE, [
      { rid: "img", mime: "image/webp", bytes: new ArrayBuffer(4) },
      {
        rid: "css",
        mime: "text/css",
        bytes: new TextEncoder().encode(".page{background:#fff}").buffer,
      },
    ]);
    const root = host.shadowRoot!;
    expect(root.querySelector("image")?.getAttribute("xlink:href")).toBe(
      "blob:test/1",
    );
    expect(root.querySelector("use")?.getAttribute("xlink:href")).toBe("#p1-0");
    expect(root.querySelector("style")?.textContent).toContain(".page{");
    expect(host.querySelector(".page")).toBeNull();
    dispose();
    expect(revoked).toEqual(["blob:test/1"]);
    expect(root.childNodes.length).toBe(0);
  });
});
