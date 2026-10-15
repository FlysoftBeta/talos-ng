import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { placeFloating } from "./placement.ts";

/** Track layout/animation even without ResizeObserver (Chrome 70). Only runs while open. */
export function useFloating({
  open,
  anchor,
  surface,
  onClose,
  align = "start",
  matchWidth = false,
  focus = false,
  escapeBubbles = false,
}: {
  open: boolean;
  anchor: RefObject<HTMLElement | null>;
  surface: RefObject<HTMLElement | null>;
  onClose: () => void;
  align?: "start" | "end" | "center";
  matchWidth?: boolean;
  focus?: boolean;
  escapeBubbles?: boolean;
}): void {
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const trigger = anchor.current,
      node = surface.current;
    if (!open || !trigger || !node) return;
    const doc = trigger.ownerDocument,
      win = doc.defaultView!;
    let frame = 0;
    const update = () => {
      const rect = trigger.getBoundingClientRect();
      let left = 0,
        top = 0,
        right = win.innerWidth,
        bottom = win.innerHeight;
      for (
        let parent = trigger.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const css = win.getComputedStyle(parent),
          box = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) {
          left = Math.max(left, box.left);
          right = Math.min(right, box.right);
        }
        if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) {
          top = Math.max(top, box.top);
          bottom = Math.min(bottom, box.bottom);
        }
      }
      if (
        trigger.matches(":disabled") ||
        !trigger.isConnected ||
        !trigger.getClientRects().length ||
        rect.bottom <= top ||
        rect.top >= bottom ||
        rect.right <= left ||
        rect.left >= right
      ) {
        close.current();
        if (focus && node.contains(doc.activeElement)) {
          const destination =
            trigger.isConnected &&
            trigger.getClientRects().length &&
            !trigger.matches(":disabled")
              ? trigger
              : node.closest<HTMLElement>('[role="dialog"]');
          destination?.focus({ preventScroll: true });
        }
        return;
      }
      node.style.maxWidth = `${Math.max(0, win.innerWidth - 16)}px`;
      if (matchWidth)
        node.style.width = `${Math.min(rect.right - rect.left, win.innerWidth - 16)}px`;
      const position = placeFloating(
        rect,
        node.getBoundingClientRect().width,
        node.scrollHeight + 2,
        { width: win.innerWidth, height: win.innerHeight },
        align,
      );
      node.style.left = `${position.left}px`;
      node.style.top = `${position.top}px`;
      node.style.maxHeight = `${position.maxHeight}px`;
      node.style.visibility = "visible";
      frame = win.requestAnimationFrame(update);
    };
    update();
    if (focus) {
      const selected = node.querySelector<HTMLElement>(
        '[aria-selected="true"]:not(:disabled)',
      );
      (
        selected ??
        node.querySelector<HTMLElement>("button:not(:disabled)") ??
        node
      ).focus({ preventScroll: true });
      selected?.scrollIntoView({ block: "nearest" });
    }
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      (trigger.contains(target) || node.contains(target));
    const away = (event: Event) => {
      if (!inside(event.target)) close.current();
    };
    const key = (event: KeyboardEvent) => {
      if (!inside(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (!escapeBubbles) event.stopPropagation();
        close.current();
        if (focus) trigger.focus({ preventScroll: true });
      } else if (event.key === "Tab" && focus) {
        close.current();
        trigger.focus({ preventScroll: true });
      }
    };
    doc.addEventListener("mousedown", away, true);
    doc.addEventListener("touchstart", away, true);
    doc.addEventListener("focusin", away, true);
    doc.addEventListener("keydown", key, true);
    return () => {
      win.cancelAnimationFrame(frame);
      doc.removeEventListener("mousedown", away, true);
      doc.removeEventListener("touchstart", away, true);
      doc.removeEventListener("focusin", away, true);
      doc.removeEventListener("keydown", key, true);
    };
  }, [open, anchor, surface, align, matchWidth, focus, escapeBubbles]);
}

/** Roving menu/listbox focus; disabled options are never keyboard destinations. */
export function moveFloatingFocus(
  event: React.KeyboardEvent<HTMLElement>,
): void {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    ),
  );
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const index =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
          buttons.length;
  buttons[index]?.focus({ preventScroll: true });
  buttons[index]?.scrollIntoView({ block: "nearest" });
}
