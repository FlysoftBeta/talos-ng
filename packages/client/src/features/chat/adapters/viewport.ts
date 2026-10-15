import type { ConversationViewport } from "../model/conversation.ts";
export function conversationViewport(
  list: () => {
    scrollToKey(id: string, align: "start" | "end" | "center"): void;
  } | null,
  viewport: () => HTMLElement | null,
): ConversationViewport {
  return {
    scroll: (id, align) => list()?.scrollToKey(id, align),
    afterLayout: (callback) => {
      requestAnimationFrame(callback);
    },
    read: () => {
      const node = viewport()?.querySelector('[data-testid="ui.virtual-list"]');
      if (!node) return undefined;
      const bounds = node.getBoundingClientRect(),
        visibleSequences: number[] = [];
      node.querySelectorAll<HTMLElement>("[data-seq]").forEach((row) => {
        const r = row.getBoundingClientRect();
        if (r.top >= bounds.top && r.bottom <= bounds.bottom)
          visibleSequences.push(Number(row.dataset.seq));
      });
      return {
        top: node.scrollTop,
        bottom: node.scrollHeight - node.scrollTop - node.clientHeight,
        visibleSequences,
      };
    },
  };
}
/** Keeps the history list as tall as its flex container (reply strips and notices change it). */
export function observeConversationHeight(
  element: () => HTMLElement | null,
  setHeight: (height: number) => void,
): () => void {
  const measure = (): void => {
    const node = element();
    setHeight(
      Math.max(160, node ? node.clientHeight : window.innerHeight - 160),
    );
  };
  measure();
  window.addEventListener("resize", measure);
  const node = element();
  const observer =
    node && typeof ResizeObserver === "function"
      ? new ResizeObserver(measure)
      : undefined;
  if (node) observer?.observe(node);
  return () => {
    window.removeEventListener("resize", measure);
    observer?.disconnect();
  };
}
