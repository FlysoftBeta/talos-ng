/** UTF-16 offsets match DOM Range and survive width/font changes. */
export function characterTop(element: HTMLElement, offset: number): number {
  const text = element.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE || !text.textContent?.length)
    return 0;
  const range = document.createRange();
  const index = Math.min(text.textContent.length - 1, Math.max(0, offset));
  range.setStart(text, index);
  range.setEnd(text, index + 1);
  return (
    range.getBoundingClientRect().top - element.getBoundingClientRect().top
  );
}
export function characterAt(element: HTMLElement, top: number): number {
  let low = 0,
    high = element.textContent?.length ?? 0;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (characterTop(element, mid) < top) low = mid + 1;
    else high = mid;
  }
  return Math.min(low, Math.max(0, (element.textContent?.length ?? 1) - 1));
}
