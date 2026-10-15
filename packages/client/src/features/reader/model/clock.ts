/** Accumulates only visible, unlocked reader time. All scheduling is injected. */
export class ReadingClock {
  private active = false;
  private since = 0;
  private elapsed = 0;
  constructor(
    private readonly now: () => number,
    initialSeconds = 0,
  ) {
    this.elapsed = initialSeconds * 1000;
  }
  setActive(active: boolean): void {
    if (active === this.active) return;
    if (this.active) this.elapsed += Math.max(0, this.now() - this.since);
    this.active = active;
    this.since = this.now();
  }
  seconds(): number {
    return Math.floor(
      (this.elapsed +
        (this.active ? Math.max(0, this.now() - this.since) : 0)) /
        1000,
    );
  }
}
