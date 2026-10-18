import type { IncidentQuery } from "./ports.ts";
import { AppError } from "@talos/base";
import { createHash } from "node:crypto";
import { createUlid, diagnosticError, diagnosticText } from "@talos/base";
import { migrate } from "../persistence/db.ts";
import type { Db } from "../persistence/db.ts";
import type { SourceMaps } from "./source-maps.ts";
export interface Incident {
  id: string;
  fingerprint: string;
  count: number;
  first: number;
  last: number;
  summary: string;
  stack: string;
  level: string;
  module: string;
  related_ids: string;
  source: "server" | "client";
  build: string;
  environment: string;
}
export class Incidents {
  private readonly id: () => string;
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
    private readonly capacity = 1000,
    readonly build = "unknown",
    private readonly maps?: SourceMaps,
  ) {
    this.id = createUlid({ clock: now });
    migrate(
      db,
      "incidents",
      [
        {
          n: 1,
          up: (db) =>
            db.exec(
              "CREATE TABLE incidents(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL UNIQUE,count INTEGER NOT NULL,first INTEGER NOT NULL,last INTEGER NOT NULL,summary TEXT NOT NULL) STRICT",
            ),
        },
        {
          n: 2,
          up: (db) =>
            db.exec(
              "ALTER TABLE incidents ADD COLUMN stack TEXT NOT NULL DEFAULT ''; ALTER TABLE incidents ADD COLUMN level TEXT NOT NULL DEFAULT 'error'; ALTER TABLE incidents ADD COLUMN module TEXT NOT NULL DEFAULT 'kernel'; ALTER TABLE incidents ADD COLUMN related_ids TEXT NOT NULL DEFAULT '[]'",
            ),
        },
        {
          n: 3,
          up: (db) =>
            db.exec(
              "ALTER TABLE incidents ADD COLUMN source TEXT NOT NULL DEFAULT 'server'; ALTER TABLE incidents ADD COLUMN build TEXT NOT NULL DEFAULT 'unknown'; ALTER TABLE incidents ADD COLUMN environment TEXT NOT NULL DEFAULT ''",
            ),
        },
      ],
      now,
    );
  }
  report(
    error: unknown,
    context?: {
      method?: string;
      level?: string;
      relatedIds?: string[];
      source?: "server" | "client";
      build?: string;
      environment?: string;
    },
  ): string {
    // Do not persist arbitrary exception messages, arguments, or credentials.
    const { name, stack: raw } = diagnosticError(error);
    const source = context?.source ?? "server";
    const build = (
      source === "server" ? this.build : (context?.build ?? "unknown")
    ).slice(0, 128);
    const environment = diagnosticText(
      source === "server"
        ? `${process.platform}/${process.arch} node/${process.version}`
        : (context?.environment ?? "unknown"),
      512,
    );
    // The fingerprint keeps the raw frames; the stored stack is the restored one.
    const stack =
      this.maps?.restore(
        raw,
        source,
        source === "server" ? this.build : build,
      ) ?? raw;
    const fingerprint = createHash("sha256")
      .update(
        `${source}\n${build}\n${environment}\n${name}\n${context?.method ?? ""}\n${raw}`,
      )
      .digest("hex");
    return this.db.tx(() => {
      const existing = this.db.get<Incident>(
        "SELECT * FROM incidents WHERE fingerprint=?",
        fingerprint,
      );
      if (existing) {
        this.db.run(
          "UPDATE incidents SET count=count+1,last=?,stack=?,related_ids=? WHERE id=?",
          this.now(),
          stack,
          JSON.stringify(context?.relatedIds ?? []),
          existing.id,
        );
        return existing.id;
      }
      const id = this.id();
      const now = this.now();
      this.db.run(
        "INSERT INTO incidents(id,fingerprint,count,first,last,summary,stack,level,module,related_ids,source,build,environment) VALUES(?,?,1,?,?,?,?,?,?,?,?,?,?)",
        id,
        fingerprint,
        now,
        now,
        `${name}: ${context?.method ?? "kernel"}`,
        stack,
        context?.level ?? "error",
        context?.method?.split(".")[0] ?? "kernel",
        JSON.stringify(context?.relatedIds ?? []),
        source,
        build,
        environment,
      );
      this.db.run(
        "DELETE FROM incidents WHERE id IN (SELECT id FROM incidents ORDER BY last DESC,id DESC LIMIT -1 OFFSET ?)",
        this.capacity,
      );
      return id;
    });
  }
  list(): Incident[] {
    return this.db.all<Incident>(
      "SELECT * FROM incidents ORDER BY last DESC,id DESC",
    );
  }
  page(input: IncidentQuery) {
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    for (const key of ["source", "build", "environment"] as const)
      if (input[key]) {
        clauses.push(`${key}=?`);
        values.push(input[key]!);
      }
    if (input.level) {
      clauses.push("level=?");
      values.push(input.level);
    }
    if (input.module) {
      clauses.push("module LIKE ?");
      values.push(`%${input.module.replace(/[\\%_]/g, "\\$&")}%`);
    }
    if (input.from !== undefined) {
      clauses.push("last>=?");
      values.push(input.from);
    }
    if (input.to !== undefined) {
      clauses.push("first<=?");
      values.push(input.to);
    }
    if (input.query) {
      clauses.push("(summary LIKE ? OR fingerprint LIKE ?)");
      const query = `%${input.query.replace(/[\\%_]/g, "\\$&")}%`;
      values.push(query, query);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const total = this.db.get<{ n: number }>(
      `SELECT count(*) AS n FROM incidents${where}`,
      ...values,
    )!.n;
    const items = this.db.all<{
      id: string;
      source: "client" | "server";
      build: string;
      environment: string;
      fingerprint: string;
      count: number;
      first: number;
      last: number;
      summary: string;
    }>(
      `SELECT id,fingerprint,count,first,last,summary,source,build,environment FROM incidents${where} ORDER BY last DESC,id DESC LIMIT ? OFFSET ?`,
      ...values,
      input.limit ?? 50,
      input.offset ?? 0,
    );
    return { items, total };
  }
  detail(id: string) {
    const row = this.db.get<{
      id: string;
      summary: string;
      stack: string;
      level: string;
      module: string;
      source: "client" | "server";
      build: string;
      environment: string;
      related_ids: string;
      count: number;
      first: number;
      last: number;
    }>("SELECT * FROM incidents WHERE id=?", id);
    if (!row) throw new AppError("E_NOT_FOUND", "事件不存在");
    return {
      id: row.id,
      summary: row.summary,
      stack: row.stack,
      source: row.source,
      build: row.build,
      environment: row.environment,
      level: row.level,
      module: row.module,
      relatedIds: JSON.parse(row.related_ids) as string[],
      count: row.count,
      first: row.first,
      last: row.last,
    };
  }
  exportRows(): Record<string, unknown>[] {
    return this.db.all<Record<string, unknown>>(
      "SELECT * FROM incidents ORDER BY last DESC LIMIT 1000",
    );
  }
}
