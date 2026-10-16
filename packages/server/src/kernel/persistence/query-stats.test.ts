import { describe, expect, it } from "vitest";
import { Db } from "./db.ts";
import { normalizeSql, QueryStats } from "./query-stats.ts";

describe("QueryStats", () => {
  it("normalizes literals and placeholder lists into one statement shape", () => {
    expect(
      normalizeSql(`SELECT * FROM t
        WHERE a = 'x''y' AND b IN (1, 2, 3) AND c=? -- note
        AND talos_0 = -4.5`),
    ).toBe("SELECT * FROM t WHERE a = ? AND b IN (?…) AND c=? AND talos_0 = ?");
    expect(normalizeSql("INSERT INTO t VALUES(?,?),(?,?),(?,?)")).toBe(
      "INSERT INTO t VALUES(?…),…",
    );
  });
  it("aggregates percentiles, merges replica snapshots and keeps slow executions", () => {
    const slow: string[] = [];
    let now = 1000;
    const writer = new QueryStats({
      slowMs: 50,
      now: () => now,
      onSlow: (query) => slow.push(`${query.source}:${query.ms}`),
    });
    const reader = new QueryStats({ slowMs: 50, now: () => now });
    for (let i = 1; i <= 100; i++) writer.record("writer", "statement", "A", i);
    for (let i = 0; i < 10; i++) reader.record("reader", "statement", "A", 1);
    now = 1500;
    reader.record("reader", "statement", "B", 70);
    now = 2000;
    const report = writer.report([reader.export()]);
    const a = report.statements.find(
      (row) => row.source === "writer" && row.sql === "A",
    )!;
    expect(a).toMatchObject({
      count: 100,
      totalMs: 5050,
      maxMs: 100,
      slow: 51,
    });
    // Log buckets bound the error to a quarter power of two.
    expect(a.p50Ms).toBeGreaterThanOrEqual(50);
    expect(a.p50Ms).toBeLessThanOrEqual(50 * 2 ** 0.25);
    expect(a.p95Ms).toBeGreaterThanOrEqual(95);
    expect(a.p95Ms).toBeLessThanOrEqual(100);
    expect(report.statements[0]).toBe(a);
    expect(
      report.statements.find(
        (row) => row.source === "reader" && row.sql === "B",
      ),
    ).toMatchObject({ count: 1, slow: 1, p50Ms: 70, maxMs: 70 });
    expect(report.recentSlow).toHaveLength(50);
    expect(report.recentSlow.at(-1)).toMatchObject({
      source: "reader",
      ms: 70,
    });
    expect(report.recentSlow[0]).toMatchObject({ source: "writer", ms: 52 });
    expect(slow).toHaveLength(51);
    writer.reset();
    expect(writer.report().statements).toEqual([]);
  });
  it("times statements and labels transactions by their caller", () => {
    const db = new Db();
    const stats = new QueryStats({ slowMs: 1000 });
    db.observe(stats);
    db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY) STRICT");
    db.tx(() => {
      db.run("INSERT INTO t VALUES(?)", 1);
      db.run("INSERT INTO t VALUES(?)", 2);
    });
    db.get("SELECT * FROM t WHERE id IN (1,2)");
    const rows = stats.report().statements;
    expect(
      rows.find((row) => row.sql === "INSERT INTO t VALUES(?)")?.count,
    ).toBe(2);
    expect(
      rows.find((row) => row.sql === "SELECT * FROM t WHERE id IN (?…)")?.count,
    ).toBe(1);
    expect(rows.find((row) => row.kind === "transaction")?.sql).toMatch(
      /^transaction @ kernel\/persistence\/query-stats\.test\.ts:\d+$/,
    );
    db.close();
  });
});
