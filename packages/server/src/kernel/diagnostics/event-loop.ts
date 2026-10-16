import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import type { EventLoopUtilization } from "node:perf_hooks";

export interface EventLoopReport {
  since: number;
  /** Timer-measured delay of the main event loop; blocking work shows up here. */
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
  meanMs: number;
  /** Fraction of wall time the loop was busy since the last reset (0..1). */
  utilization: number;
}

/** Main-thread event-loop delay and utilisation since the last reset. */
export class EventLoopMonitor {
  private readonly histogram: ReturnType<typeof monitorEventLoopDelay>;
  private baseline: EventLoopUtilization;
  private since: number;
  constructor(private readonly now: () => number = Date.now) {
    this.histogram = monitorEventLoopDelay({ resolution: 10 });
    this.histogram.enable();
    this.baseline = performance.eventLoopUtilization();
    this.since = now();
  }
  report(): EventLoopReport {
    const ms = (ns: number) => Math.round(ns / 1e4) / 100;
    const h = this.histogram;
    const count = h.count;
    return {
      since: this.since,
      p50Ms: count ? ms(h.percentile(50)) : 0,
      p99Ms: count ? ms(h.percentile(99)) : 0,
      maxMs: count ? ms(h.max) : 0,
      meanMs: count ? ms(h.mean) : 0,
      utilization:
        Math.round(
          performance.eventLoopUtilization(this.baseline).utilization * 1000,
        ) / 1000,
    };
  }
  reset(): void {
    this.histogram.reset();
    this.baseline = performance.eventLoopUtilization();
    this.since = this.now();
  }
  close(): void {
    this.histogram.disable();
  }
}
