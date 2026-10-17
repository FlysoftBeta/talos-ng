import { contract } from "@talos/contract";
import type { AdminPerformance } from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { Capability } from "../../../core/lifecycle/snapshot.ts";
import type { RuntimeQueryPort } from "../../../core/runtime-port.ts";
import { shanghaiDate } from "./format.ts";
import { QueryResource, adminCall, sameValue } from "./query.ts";
import type { AdminCommandPort, LoadState } from "./query.ts";

export type PerformancePort = AdminCommandPort &
  Pick<RuntimeQueryPort, "subscribe">;
type Statement = AdminPerformance["queries"]["statements"][number];

export interface StatementRow {
  key: string;
  where: string;
  sql: string;
  count: number;
  total: string;
  p50: string;
  p95: string;
  max: string;
  slow: number;
}
export interface SlowRow {
  key: string;
  time: string;
  where: string;
  sql: string;
  ms: string;
}
const ms = (value: number): string =>
  value >= 100
    ? value.toFixed(0)
    : value >= 1
      ? value.toFixed(1)
      : value.toFixed(3);
const where = (source: string, kind: string): string =>
  `${source === "reader" ? "只读副本" : "写连接"}${kind === "transaction" ? "·事务" : ""}`;
export const statementRow = (row: Statement, index: number): StatementRow => ({
  key: `${index}:${row.source}:${row.kind}:${row.sql}`,
  where: where(row.source, row.kind),
  sql: row.sql,
  count: row.count,
  total: ms(row.totalMs),
  p50: ms(row.p50Ms),
  p95: ms(row.p95Ms),
  max: ms(row.maxMs),
  slow: row.slow,
});

/** Summary lines shown above the statement table. */
export function performanceSummary(data: AdminPerformance): {
  label: string;
  value: string;
}[] {
  const loop = data.eventLoop;
  const replicas = data.replicas;
  return [
    { label: "统计起点", value: shanghaiDate(data.queries.since) },
    { label: "慢查询阈值", value: `${data.queries.slowMs} ms` },
    {
      label: "事件循环延迟",
      value: `p50 ${ms(loop.p50Ms)} / p99 ${ms(loop.p99Ms)} / 最大 ${ms(loop.maxMs)} ms`,
    },
    {
      label: "主线程占用",
      value: `${Math.round(loop.utilization * 100)}%`,
    },
    {
      label: "只读副本",
      value: replicas
        ? `${replicas.ready}/${replicas.size} 可用，完成 ${replicas.completed}，失败 ${replicas.failed}，重启 ${replicas.restarts}`
        : "未启用",
    },
    ...(data.queries.dropped
      ? [{ label: "未统计语句", value: String(data.queries.dropped) }]
      : []),
  ];
}

export interface PerformanceState {
  access: Capability;
  data: LoadState<AdminPerformance>;
}

/** Statement timings, recent slow queries and event-loop delay since the last reset. */
export class PerformanceController extends StateStore<PerformanceState> {
  private cleanup: (() => void) | undefined;
  private readonly resource = new QueryResource<AdminPerformance>((data) =>
    this.patch({ data }),
  );
  constructor(private readonly port: PerformancePort) {
    super({
      access: port.can(contract.admin.performance.get),
      data: { data: undefined, loading: true, error: "" },
    });
  }
  attach(): void {
    this.cleanup = this.port.subscribe(() => {
      const access = this.port.can(contract.admin.performance.get);
      if (!sameValue(access, this.state.access)) this.patch({ access });
    });
    this.load(false);
  }
  detach(): void {
    this.cleanup?.();
    this.cleanup = undefined;
    this.resource.cancel();
  }
  statements(): StatementRow[] {
    return (this.state.data.data?.queries.statements ?? []).map(statementRow);
  }
  slow(): SlowRow[] {
    return [...(this.state.data.data?.queries.recentSlow ?? [])]
      .reverse()
      .map((row, index) => ({
        key: `${index}:${row.at}`,
        time: shanghaiDate(row.at),
        where: where(row.source, row.kind),
        sql: row.sql,
        ms: ms(row.ms),
      }));
  }
  reload = (): void => this.load(false);
  /** Starts a new measurement window; the report shown is the window just closed. */
  reset = (): void => this.load(true);
  private load(reset: boolean): void {
    this.resource.run(() =>
      adminCall(this.port, contract.admin.performance.get, { reset }),
    );
  }
}
