/**
 * Unread messages as one ranking factor next to the user's own frecency. The boost is
 * a fraction of the item's own score, so it lifts what the user engages with and cannot
 * pull a rarely opened item to the top; it grows with the unread count with diminishing
 * returns and fades with the age of the newest unread message.
 */
export interface UnreadSignal {
  /** Messages not read yet. */
  readonly count: number;
  /** Time of the newest unread message (ms). */
  readonly newestAt: number;
}

const DAY = 24 * 60 * 60 * 1000;
export const UNREAD_HALF_LIFE_MS = DAY;
/** The most an unread burst adds, relative to the item's own score. */
export const UNREAD_MAX_FRACTION = 0.5;
/** Unread count at which the count term saturates (log2(1 + n) / log2(1 + n_max)). */
const SATURATION = 15;

/**
 * Extra score for `own` (the item's decayed frecency) given the best score `top` in the
 * list. Scaled by engagement `own / top`, so a barely used item gains almost nothing.
 */
export function unreadBoost(
  own: number,
  top: number,
  signal: UnreadSignal | undefined,
  now: number,
): number {
  if (!signal || signal.count <= 0 || own <= 0 || top <= 0) return 0;
  const count = Math.min(
      1,
      Math.log2(1 + signal.count) / Math.log2(1 + SATURATION),
    ),
    fade = Math.pow(
      0.5,
      Math.max(0, now - signal.newestAt) / UNREAD_HALF_LIFE_MS,
    ),
    engagement = Math.min(1, own / top);
  return own * UNREAD_MAX_FRACTION * count * fade * engagement;
}
