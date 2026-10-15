/**
 * ResizeObserver-free measurement. Polling catches CSS animations and layout changes;
 * mutations catch script changes made later in the same animation frame, before paint.
 * Ignore the driver's own layer styles so geometry writes cannot feed back indefinitely.
 */
export function observeFallback(
  scroll: HTMLElement,
  layers: readonly HTMLElement[],
  measure: () => void,
): () => void {
  let frame = 0;
  const tick = (): void => {
    measure();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.type !== "attributes" ||
          record.attributeName !== "style" ||
          !layers.includes(record.target as HTMLElement),
      )
    )
      measure();
  });
  observer.observe(scroll, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
  };
}
