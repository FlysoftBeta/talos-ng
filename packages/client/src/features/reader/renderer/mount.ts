import { utf8Decode } from "@talos/base";
import { cleanCss, sanitizePage } from "./sanitize.ts";

export interface PageResource {
  rid: string;
  mime: string;
  bytes: ArrayBuffer;
}

const HOST_STYLE = ":host{display:block;contain:layout paint;overflow:hidden}";

/**
 * Words are positioned at the PDF's own glyph widths; stretch each rendered word to match,
 * measuring against the page scale applied by an ancestor transform.
 */
function fitWords(host: HTMLElement, root: ParentNode): void {
  const box = host.getBoundingClientRect();
  const scale = host.offsetWidth ? box.width / host.offsetWidth : 1;
  if (!(scale > 0)) return;
  root.querySelectorAll<HTMLElement>(".word").forEach((word) => {
    const target = Number.parseFloat(word.style.width);
    if (!(target > 0) || !word.textContent || word.textContent.length < 2)
      return;
    word.style.transform = "none";
    const range = document.createRange();
    range.selectNodeContents(word);
    const natural = range.getBoundingClientRect().width / scale;
    word.style.removeProperty("transform");
    if (natural > 0)
      word.style.setProperty(
        "--fit-x",
        String(Math.max(0.5, Math.min(2, target / natural))),
      );
  });
}

/**
 * Renders one converted page into a shadow root of `host`: style isolation without a
 * frame, so scrolling, selection and layout belong to the host page. Returns the
 * disposer that revokes the blob URLs. Page scripts are never executed.
 */
export function mountPage(
  host: HTMLElement,
  html: string,
  resources: readonly PageResource[],
): () => void {
  const page = sanitizePage(
    html,
    new Map(resources.map((r) => [r.rid, { mime: r.mime }])),
  );
  const urls: string[] = [];
  const refs = new Map<string, string>();
  for (const r of resources) {
    if (!r.mime.startsWith("image/")) continue;
    const url = URL.createObjectURL(new Blob([r.bytes], { type: r.mime }));
    urls.push(url);
    refs.set(r.rid, url);
  }
  page.querySelectorAll("[data-bundle-ref]").forEach((node) => {
    const url = refs.get(node.getAttribute("data-bundle-ref")!)!;
    for (const name of ["href", "src", "xlink:href"])
      if (node.hasAttribute(name)) node.setAttribute(name, url);
    node.removeAttribute("data-bundle-ref");
  });
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent =
    HOST_STYLE +
    resources
      .filter((r) => r.mime === "text/css")
      .map((r) => cleanCss(utf8Decode(new Uint8Array(r.bytes))))
      .join("\n");
  root.textContent = "";
  root.appendChild(style);
  root.appendChild(document.importNode(page, true));
  let closed = false;
  const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } })
    .fonts;
  void (fonts ? fonts.ready : Promise.resolve()).then(() => {
    if (!closed) fitWords(host, root);
  });
  return () => {
    closed = true;
    root.textContent = "";
    urls.forEach((url) => URL.revokeObjectURL(url));
  };
}
