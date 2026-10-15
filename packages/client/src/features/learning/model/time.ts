export interface LearningTime {
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}
/** One timer, accumulated visible/unlocked use; paused intervals never count. */
export class ActiveDeadline {
  private handle?: unknown;
  private since = 0;
  private left: number;
  private active = false;
  private fired = false;
  constructor(
    private readonly time: LearningTime,
    private readonly duration: number,
    private readonly fire: () => void,
  ) {
    this.left = duration;
  }
  setActive(active: boolean): void {
    if (this.active === active || this.fired) return;
    if (this.active) {
      this.left = Math.max(0, this.left - (this.time.now() - this.since));
      this.time.clear(this.handle);
    }
    this.active = active;
    if (active) {
      this.since = this.time.now();
      this.handle = this.time.set(() => {
        this.active = false;
        this.fired = true;
        this.left = 0;
        this.fire();
      }, this.left);
    }
  }
  remaining(): number {
    return Math.max(
      0,
      this.left - (this.active ? this.time.now() - this.since : 0),
    );
  }
  reset(): void {
    this.time.clear(this.handle);
    this.active = false;
    this.fired = false;
    this.left = this.duration;
  }
  close(): void {
    this.time.clear(this.handle);
    this.active = false;
    this.fired = true;
  }
}
