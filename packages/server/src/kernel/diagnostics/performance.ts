import { QueryStats } from "../persistence/query-stats.ts";
import type {
  QueryReport,
  RawQueryStats,
  SlowQuery,
} from "../persistence/query-stats.ts";
import type { ReplicaStatus } from "../persistence/replica-pool.ts";
import { EventLoopMonitor } from "./event-loop.ts";
import type { EventLoopReport } from "./event-loop.ts";

export interface PerformanceReport {
  queries: QueryReport;
  eventLoop: EventLoopReport;
  replicas: ReplicaStatus | null;
}
export interface ReplicaDiagnostics {
  stats(): Promise<RawQueryStats[]>;
  reset(): Promise<void>;
  status(): ReplicaStatus;
}

/** Writer statement timings, replica timings and main event-loop delay, for admins. */
export class PerformanceMonitor {
  readonly queries: QueryStats;
  private readonly loop: EventLoopMonitor;
  private replicas: ReplicaDiagnostics | undefined;
  constructor(options: {
    slowMs: number;
    now?: () => number;
    onSlow?(query: SlowQuery): void;
  }) {
    this.queries = new QueryStats(options);
    this.loop = new EventLoopMonitor(options.now);
  }
  attachReplicas(replicas: ReplicaDiagnostics | undefined): void {
    this.replicas = replicas;
  }
  async report(reset = false): Promise<PerformanceReport> {
    const replicas = this.replicas;
    const report: PerformanceReport = {
      queries: this.queries.report(replicas ? await replicas.stats() : []),
      eventLoop: this.loop.report(),
      replicas: replicas?.status() ?? null,
    };
    if (reset) {
      this.queries.reset();
      this.loop.reset();
      await replicas?.reset();
    }
    return report;
  }
  close(): void {
    this.loop.close();
  }
}
