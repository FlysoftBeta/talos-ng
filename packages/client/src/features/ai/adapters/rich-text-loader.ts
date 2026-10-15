import type { AiRenderer } from "../model/blocks.ts";

/** Loads the separately bundled Markdown/KaTeX renderer on first use; fails offline when it was never cached. */
export function loadRenderer(): Promise<AiRenderer> {
  if (window.__talosAiRenderer)
    return Promise.resolve(window.__talosAiRenderer);
  return new Promise((resolve, reject) => {
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="talos-ai-renderer"]',
    );
    if (!meta) {
      reject(new Error("富文本资源不可用"));
      return;
    }
    const assets = JSON.parse(meta.content) as string[];
    for (const href of assets.filter((a) => a.endsWith(".css"))) {
      if (!document.querySelector(`link[href="${href}"]`)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        document.head.appendChild(link);
      }
    }
    const src = assets.find((a) => a.endsWith(".js"))!;
    let script = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`,
    );
    const done = () =>
      window.__talosAiRenderer
        ? resolve(window.__talosAiRenderer)
        : reject(new Error("富文本资源未加载"));
    if (script) {
      script.addEventListener("load", done, { once: true });
      script.addEventListener(
        "error",
        () => reject(new Error("富文本资源未缓存")),
        { once: true },
      );
    } else {
      script = document.createElement("script");
      script.src = src;
      script.onload = done;
      script.onerror = () => {
        script?.remove();
        reject(new Error("富文本资源未缓存"));
      };
      document.head.appendChild(script);
    }
  });
}
/** Opens an external link in a new, isolated browsing context. */
export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
