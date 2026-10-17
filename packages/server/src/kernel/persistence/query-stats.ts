/**
 * Per-statement timing for the SQLite adapter: bounded aggregation by normalized
 * SQL with log-bucketed histograms (mergeable across reader workers) and a short
 * ring of recent slow executions. Values never include bound parameters.
 */
export type QuerySource = "writer" | "reader";
export type QueryKind = "statement" | "transaction";

/** Histogram buckets: four per power of two of microseconds, up to ~70 minutes. */
const BUCKETS = 128;
const MAX_KEYS = 400;
const RECENT = 50;

export interface RawQueryEntry {
  source: QuerySource;
  kind: QueryKind;
  sql: string;
  count: number;
  totalMs: number;
  maxMs: number;
  slow: number;
  buckets: number[];
}
export interface RawQueryStats {
  since: number;
  entries: RawQueryEntry[];
  recent: SlowQuery[];
  dropped: number;
}
export interface SlowQuery {
  source: QuerySource;
  kind: QueryKind;
  sql: string;
  ms: number;
  at: number;
}
export interface QueryStatRow {
  source: QuerySource;
  kind: QueryKind;
  sql: string;
  count: number;
  totalMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  slow: number;
}
export interface QueryReport {
  since: number;
  slowMs: number;
  statements: QueryStatRow[];
  recentSlow: SlowQuery[];
  /** Distinct statements not tracked because the key table was full. */
  dropped: number;
}

interface Entry {
  source: QuerySource;
  kind: QueryKind;
  sql: string;
  count: number;
  totalMs: number;
  maxMs: number;
  slow: number;
  buckets: Uint32Array;
}

/** Collapse a statement to its shape: literals and IN-lists become placeholders. */
export function normalizeSql(sql: string): string {
  const shape = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/'(?:[^']|'')*'/g, "?")
    .replace(/(?<![\w$])-?\d+(?:\.\d+)?(?![\w$])/g, "?")
    .replace(/\?(?:\s*,\s*\?)+/g, "?…")
    .replace(/\(\s*\?…?\s*\)(?:\s*,\s*\(\s*\?…?\s*\))+/g, "(?…),…");
  return shape.length > 600 ? `${shape.slice(0, 600)}…` : shape;
}

function bucketOf(ms: number): number {
  const us = ms * 1000;
  if (!(us > 1)) return 0;
  return Math.min(BUCKETS - 1, Math.floor(Math.log2(us) * 4) + 1);
}
/** Upper bound of a bucket in milliseconds. */
function bucketMs(index: number): number {
  return index === 0 ? 0.001 : 2 ** (index / 4) / 1000;
}
function percentile(entry: Entry, q: number): number {
  const target = Math.max(1, Math.ceil(entry.count * q));
  let seen = 0;
  for (let i = 0; i < BUCKETS; i++) {
    seen += entry.buckets[i]!;
    if (seen >= target) return Math.min(entry.maxMs, bucketMs(i));
  }
  return entry.maxMs;
}
const round = (ms: number) => Math.round(ms * 1000) / 1000;

export class QueryStats {
  private entries = new Map<string, Entry>();
  private recent: SlowQuery[] = [];
  private dropped = 0;
  private since: number;
  constructor(
    private readonly options: {
      slowMs: number;
      now?: () => number;
      /** Called for every execution at or above the threshold. */
      onSlow?(query: SlowQuery): void;
    },
  ) {
    this.since = this.now();
  }
  get slowMs(): number {
    return this.options.slowMs;
  }
  record(source: QuerySource, kind: QueryKind, sql: string, ms: number): void {
    const entry = this.entry(source, kind, sql);
    if (entry) {
      entry.count++;
      entry.totalMs += ms;
      if (ms > entry.maxMs) entry.maxMs = ms;
      entry.buckets[bucketOf(ms)]!++;
    }
    if (ms < this.options.slowMs) return;
    if (entry) entry.slow++;
    const slow = { source, kind, sql, ms: round(ms), at: this.now() };
    this.recent.push(slow);
    if (this.recent.length > RECENT) this.recent.shift();
    try {
      this.options.onSlow?.(slow);
    } catch {
      /* Reporting never fails a query. */
    }
  }
  export(): RawQueryStats {
    return {
      since: this.since,
      dropped: this.dropped,
      recent: [...this.recent],
      entries: [...this.entries.values()].map((entry) => ({
        ...entry,
        buckets: [...entry.buckets],
      })),
    };
  }
  reset(): void {
    this.entries.clear();
    this.recent = [];
    this.dropped = 0;
    this.since = this.now();
  }
  /** Combine raw snapshots (this one first) into a report sorted by total time. */
  report(others: readonly RawQueryStats[] = [], limit = 100): QueryReport {
    const merged = new QueryStats({ slowMs: this.options.slowMs });
    let since = this.since;
    for (const raw of [this.export(), ...others]) {
      since = Math.min(since, raw.since);
      merged.absorb(raw);
    }
    const statements = [...merged.entries.values()]
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, limit)
      .map((entry) => ({
        source: entry.source,
        kind: entry.kind,
        sql: entry.sql,
        count: entry.count,
        totalMs: round(entry.totalMs),
        p50Ms: round(percentile(entry, 0.5)),
        p95Ms: round(percentile(entry, 0.95)),
        maxMs: round(entry.maxMs),
        slow: entry.slow,
      }));
    return {
      since,
      slowMs: this.options.slowMs,
      statements,
      recentSlow: merged.recent.sort((a, b) => a.at - b.at).slice(-RECENT),
      dropped: merged.dropped,
    };
  }
  private absorb(raw: RawQueryStats): void {
    this.dropped += raw.dropped;
    this.recent.push(...raw.recent);
    for (const item of raw.entries) {
      const entry = this.entry(item.source, item.kind, item.sql);
      if (!entry) continue;
      entry.count += item.count;
      entry.totalMs += item.totalMs;
      entry.maxMs = Math.max(entry.maxMs, item.maxMs);
      entry.slow += item.slow;
      for (let i = 0; i < BUCKETS; i++)
        entry.buckets[i]! += item.buckets[i] ?? 0;
    }
  }
  private entry(
    source: QuerySource,
    kind: QueryKind,
    sql: string,
  ): Entry | undefined {
    const key = `${source}\u0000${kind}\u0000${sql}`;
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= MAX_KEYS) {
        this.dropped++;
        return undefined;
      }
      entry = {
        source,
        kind,
        sql,
        count: 0,
        totalMs: 0,
        maxMs: 0,
        slow: 0,
        buckets: new Uint32Array(BUCKETS),
      };
      this.entries.set(key, entry);
    }
    return entry;
  }
  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}
