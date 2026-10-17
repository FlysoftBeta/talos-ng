export interface AnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
/** Viewport coordinates, independent of the DOM and feature state. */
export function placeFloating(
  anchor: AnchorRect,
  width: number,
  height: number,
  viewport: { width: number; height: number },
  align: "start" | "end" | "center" = "start",
  side: "auto" | "above" = "auto",
): { left: number; top: number; maxHeight: number } {
  const margin = 8,
    gap = 4;
  const below = Math.max(0, viewport.height - margin - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - margin);
  const up =
    side === "above"
      ? above >= Math.min(height, 160) || above > below
      : height > below && above > below;
  const maxHeight = Math.min(320, up ? above : below);
  const left =
    align === "end"
      ? anchor.right - width
      : align === "center"
        ? (anchor.left + anchor.right - width) / 2
        : anchor.left;
  return {
    left: Math.max(margin, Math.min(left, viewport.width - width - margin)),
    top: Math.max(
      margin,
      Math.min(
        up
          ? anchor.top - gap - Math.min(height, maxHeight)
          : anchor.bottom + gap,
        viewport.height - Math.min(height, maxHeight) - margin,
      ),
    ),
    maxHeight,
  };
}
