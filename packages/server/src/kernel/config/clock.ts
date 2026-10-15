export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export const systemClock: Clock = Object.freeze({
  now: () => Date.now(),
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
});
