const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const MAX_TIME = 281474976710655;
function timestamp(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_TIME)
    throw new RangeError("ULID timestamp must be an unsigned 48-bit integer");
}
function encode(value: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out = ALPHABET[value % 32]! + out;
    value = Math.floor(value / 32);
  }
  return out;
}
export interface UlidOptions {
  clock?: () => number;
  random?: () => number;
}
export function createUlid({
  clock = Date.now,
  random = Math.random,
}: UlidOptions = {}): (now?: number, random?: () => number) => string {
  let last = -1;
  let digits: number[] = [];
  return (now = clock(), source = random) => {
    timestamp(now);
    const ms = Math.max(now, last);
    const next = digits.slice();
    if (ms > last) {
      for (let i = 0; i < 16; i++) {
        const value = source();
        if (!Number.isFinite(value) || value < 0 || value >= 1)
          throw new RangeError("Random must return a number in [0, 1)");
        next[i] = Math.floor(value * 32);
      }
    } else {
      let i = 15;
      while (i >= 0 && next[i] === 31) {
        next[i] = 0;
        i--;
      }
      if (i < 0)
        throw new RangeError("ULID randomness exhausted for this millisecond");
      next[i] = next[i]! + 1;
    }
    last = ms;
    digits = next;
    return encode(ms, 10) + next.map((n) => ALPHABET[n]).join("");
  };
}
export const ulid = createUlid();
export function isUlid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === 26 &&
    /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(value)
  );
}
export function ulidTime(value: string): number {
  if (!isUlid(value)) throw new TypeError("Invalid ULID");
  let ms = 0;
  for (let i = 0; i < 10; i++) ms = ms * 32 + ALPHABET.indexOf(value.charAt(i));
  return ms;
}
