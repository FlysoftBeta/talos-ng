export type Direction = "U" | "D" | "L" | "R";
export const UNLOCK_SEQUENCE: readonly Direction[] = [
  "U",
  "U",
  "D",
  "D",
  "L",
  "R",
  "L",
  "R",
];
export function tapDirection(
  x: number,
  y: number,
  width: number,
  height: number,
): Direction | null {
  if (y / height < 0.33) return "U";
  if (y / height > 0.67) return "D";
  if (x / width < 0.33) return "L";
  if (x / width > 0.67) return "R";
  return null;
}
export function keyDirection(key: string): Direction | undefined {
  return (
    {
      ArrowUp: "U",
      w: "U",
      W: "U",
      ArrowDown: "D",
      s: "D",
      S: "D",
      ArrowLeft: "L",
      a: "L",
      A: "L",
      ArrowRight: "R",
      d: "R",
      D: "R",
    } as Record<string, Direction>
  )[key];
}
/** A wrong input resets completely; it is not reused as a new first input. */
export class ConcealmentSequence {
  private progress = 0;
  private ignoreMouseUntil = 0;
  constructor(private readonly now: () => number = Date.now) {}
  input(direction: Direction | null): boolean {
    this.progress =
      direction === UNLOCK_SEQUENCE[this.progress] ? this.progress + 1 : 0;
    if (this.progress !== UNLOCK_SEQUENCE.length) return false;
    this.progress = 0;
    return true;
  }
  touch(direction: Direction | null): boolean {
    this.ignoreMouseUntil = this.now() + 700;
    return this.input(direction);
  }
  mouse(direction: Direction | null): boolean {
    return this.now() >= this.ignoreMouseUntil && this.input(direction);
  }
}

/** Hidden unlock gesture: keys and pointer taps (given with the viewport size) feed one sequence. */
export class ConcealedController {
  private readonly sequence: ConcealmentSequence;
  constructor(
    private readonly onReveal: () => void,
    now?: () => number,
  ) {
    this.sequence = new ConcealmentSequence(now);
  }
  /** Returns true when the key is a gesture key and must not reach the browser. */
  key(key: string): boolean {
    const direction = keyDirection(key);
    if (!direction) return false;
    if (this.sequence.input(direction)) this.onReveal();
    return true;
  }
  touch(x: number, y: number, width: number, height: number): void {
    if (this.sequence.touch(tapDirection(x, y, width, height))) this.onReveal();
  }
  mouse(x: number, y: number, width: number, height: number): void {
    if (this.sequence.mouse(tapDirection(x, y, width, height))) this.onReveal();
  }
}
