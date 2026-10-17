import { AppError } from "@talos/base";

/** Stylesheet text that cannot fetch anything except inline, blob and fragment URLs. */
export function cleanCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)(?!#|data:|blob:)[^)]*\)/gi, "url(about:blank)");
}

const removed =
  "base,iframe,frame,object,embed,form,input,button,textarea,select,meta,link,style,script,foreignObject";
const linkAttributes = ["href", "src", "xlink:href", "poster"];

/**
 * Parses a converter page (a full HTML document in render format 1, a bare `main.page`
 * fragment from format 2) and returns the page element with everything executable or
 * external removed. Resource slots (`data-bundle-ref`) are validated against the unit's
 * resources and kept for the mount step; same-document `<use>` references survive.
 */
export function sanitizePage(
  html: string,
  resources: ReadonlyMap<string, { mime: string }>,
): HTMLElement {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const page = doc.querySelector<HTMLElement>("main.page, .page");
  if (!page) throw new AppError("E_INTEGRITY", "页面格式错误");
  page.querySelectorAll(removed).forEach((node) => node.remove());
  page.querySelectorAll("*").forEach((node) => {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (/^on/.test(name) || ["srcdoc", "nonce", "srcset"].includes(name))
        node.removeAttribute(attr.name);
      else if (name === "style") attr.value = cleanCss(attr.value);
    }
    const ref = node.getAttribute("data-bundle-ref");
    if (ref) {
      const resource = resources.get(ref);
      if (!resource) throw new AppError("E_INTEGRITY", "页面依赖缺失");
      if (!/^image\/(webp|png|jpeg|gif|svg\+xml)$/.test(resource.mime))
        throw new AppError("E_INTEGRITY", "页面资源类型错误");
    }
    for (const name of linkAttributes) {
      const value = node.getAttribute(name);
      if (value === null) continue;
      // A bundle slot is filled with a blob URL on mount; the only other allowed link is
      // the SVG `<use>` reference to a definition on the same page.
      const local =
        node.localName === "use" &&
        /^#[\w.:-]+$/.test(value) &&
        name !== "src" &&
        name !== "poster";
      if (ref) node.setAttribute(name, "#");
      else if (!local) node.removeAttribute(name);
    }
  });
  return page;
}
