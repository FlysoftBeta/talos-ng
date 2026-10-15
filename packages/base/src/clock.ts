export interface Stamp {
  readonly ms: number;
  readonly counter: number;
}
function validateStamp(stamp: Stamp): void {
  if (
    !Number.isSafeInteger(stamp.ms) ||
    stamp.ms < 0 ||
    !Number.isSafeInteger(stamp.counter) ||
    stamp.counter < 0
  )
    throw new RangeError("Invalid hybrid clock stamp");
}
export function compareStamp(a: Stamp, b: Stamp): number {
  validateStamp(a);
  validateStamp(b);
  return a.ms < b.ms
    ? -1
    : a.ms > b.ms
      ? 1
      : a.counter < b.counter
        ? -1
        : a.counter > b.counter
          ? 1
          : 0;
}
export function encodeStamp(stamp: Stamp): string {
  validateStamp(stamp);
  return `${String(stamp.ms).padStart(16, "0")}:${String(stamp.counter).padStart(16, "0")}`;
}
export class HybridClock {
  private stamp: Stamp = { ms: 0, counter: 0 };
  constructor(private readonly clock: () => number = Date.now) {}
  now(): Stamp {
    return this.advance();
  }
  observe(remote: Stamp): Stamp {
    validateStamp(remote);
    return this.advance(remote);
  }
  private advance(remote?: Stamp): Stamp {
    const wall = this.clock();
    validateStamp({ ms: wall, counter: 0 });
    const ms = Math.max(wall, this.stamp.ms, remote?.ms ?? 0);
    let counter = 0;
    if (ms === this.stamp.ms) counter = this.stamp.counter + 1;
    if (remote && ms === remote.ms)
      counter = Math.max(counter, remote.counter + 1);
    const next = { ms, counter };
    validateStamp(next);
    this.stamp = next;
    return { ...next };
  }
}
