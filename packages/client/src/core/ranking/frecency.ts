/**
 * Frecency: one compact counter per item combines how often and how recently it
 * was opened. The counter is an exponentially decayed visit count stored as
 * `score` as of time `at`; every visit decays the old score to now and adds 1.
 * Everything here is pure (the caller supplies `now`).
 */
export interface Frecency {
  /** Decayed visit count as of `at`. */
  readonly score: number;
  /** Time of the latest counted visit (ms). */
  readonly at: number;
}

export interface Ranked<K extends string = string> {
  readonly key: K;
  readonly entry: Frecency;
}

const DAY = 24 * 60 * 60 * 1000;
export const HALF_LIFE_MS = 14 * DAY;
/** Visits closer together than this count as one (re-renders, quick back-and-forth). */
export const MIN_VISIT_GAP_MS = 30 * 1000;

/** The entry's score decayed to `now`; clocks running backwards do not inflate it. */
export function scoreAt(
  entry: Frecency,
  now: number,
  halfLifeMs: number = HALF_LIFE_MS,
): number {
  const age = Math.max(0, now - entry.at);
  return entry.score * Math.pow(0.5, age / halfLifeMs);
}

/** Counts one visit; a visit within MIN_VISIT_GAP_MS of the last one is not counted. */
export function visit(
  entry: Frecency | undefined,
  now: number,
  halfLifeMs: number = HALF_LIFE_MS,
): Frecency {
  if (!entry) return { score: 1, at: now };
  if (now >= entry.at && now - entry.at < MIN_VISIT_GAP_MS) return entry;
  const score = scoreAt(entry, now, halfLifeMs) + 1;
  return {
    score: Math.round(score * 1000) / 1000,
    at: Math.max(now, entry.at),
  };
}

export interface CutOff {
  /** Absolute floor on the decayed score. */
  minScore: number;
  /** Items must reach this fraction of the top score. */
  relative: number;
  /** Hard cap on the list length. */
  max: number;
  halfLifeMs: number;
}

export const FRECENT_CUTOFF: CutOff = {
  minScore: 0.35,
  relative: 0.25,
  max: 8,
  halfLifeMs: HALF_LIFE_MS,
};
export const FREQUENT_CUTOFF: CutOff = {
  minScore: 2,
  relative: 0.3,
  max: 6,
  halfLifeMs: HALF_LIFE_MS,
};
export const RECENT_MAX_AGE_MS = 14 * DAY;
export const RECENT_MAX = 6;

/**
 * Items by descending frecency, cut where the score stops being meaningful: below
 * the absolute floor or below a fraction of the best item. The length varies
 * with the data and never exceeds `max`.
 */
export function selectFrecent<K extends string>(
  items: readonly Ranked<K>[],
  now: number,
  cutOff: Partial<CutOff> = {},
): K[] {
  const c = { ...FRECENT_CUTOFF, ...cutOff };
  const scored = items
    .map((item) => ({ ...item, value: scoreAt(item.entry, now, c.halfLifeMs) }))
    .filter((item) => Number.isFinite(item.value))
    .sort(
      (a, b) =>
        b.value - a.value ||
        b.entry.at - a.entry.at ||
        (a.key < b.key ? -1 : 1),
    );
  const top = scored[0]?.value ?? 0;
  const floor = Math.max(c.minScore, top * c.relative);
  return scored
    .filter((item) => item.value >= floor)
    .slice(0, Math.max(0, c.max))
    .map((item) => item.key);
}

/** Most recently opened first, limited to the last `maxAgeMs` and `max` items. */
export function selectRecent<K extends string>(
  items: readonly Ranked<K>[],
  now: number,
  options: { maxAgeMs?: number; max?: number } = {},
): K[] {
  const maxAge = options.maxAgeMs ?? RECENT_MAX_AGE_MS,
    max = options.max ?? RECENT_MAX;
  return items
    .filter((item) => now - item.entry.at <= maxAge)
    .sort((a, b) => b.entry.at - a.entry.at || (a.key < b.key ? -1 : 1))
    .slice(0, Math.max(0, max))
    .map((item) => item.key);
}

/** Frequently visited items that the recent list does not already show. */
export function selectFrequent<K extends string>(
  items: readonly Ranked<K>[],
  now: number,
  exclude: readonly K[] = [],
  cutOff: Partial<CutOff> = {},
): K[] {
  const skip = new Set<string>(exclude);
  return selectFrecent(
    items.filter((item) => !skip.has(item.key)),
    now,
    { ...FREQUENT_CUTOFF, ...cutOff },
  );
}

/** Keeps the `limit` highest-frecency entries (ties: most recent), dropping the rest. */
export function pruneHistory<K extends string>(
  history: Readonly<Record<K, Frecency>>,
  limit: number,
  now: number,
): Record<K, Frecency> {
  const keys = (Object.keys(history) as K[]).sort(
    (a, b) =>
      scoreAt(history[b], now) - scoreAt(history[a], now) ||
      history[b].at - history[a].at,
  );
  const out = {} as Record<K, Frecency>;
  for (const key of keys.slice(0, Math.max(0, limit))) out[key] = history[key];
  return out;
}
