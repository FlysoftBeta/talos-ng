export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  jitter: number;
  random?: () => number;
}
export function backoff({
  baseMs,
  maxMs,
  jitter,
  random = Math.random,
}: BackoffOptions): { next(): number; reset(): void } {
  if (
    !Number.isFinite(baseMs) ||
    baseMs <= 0 ||
    !Number.isFinite(maxMs) ||
    maxMs < baseMs ||
    !Number.isFinite(jitter) ||
    jitter < 0 ||
    jitter > 1
  )
    throw new RangeError("Invalid backoff options");
  let delay = baseMs;
  return {
    next() {
      const sample = jitter === 0 ? 0.5 : random();
      if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
        throw new RangeError("Random must return a number in [0, 1)");
      const value = Math.max(
        0,
        Math.min(maxMs, delay * (1 + jitter * (2 * sample - 1))),
      );
      delay = Math.min(maxMs, delay * 2);
      return Math.floor(value);
    },
    reset() {
      delay = baseMs;
    },
  };
}
