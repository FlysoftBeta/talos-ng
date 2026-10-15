import type { DiagnosticPage } from "./ports.ts";
import { createUlid } from "@talos/base";
import { migrate } from "../persistence/db.ts";
import type { Db } from "../persistence/db.ts";
export interface AuditEntry {
  id: string;
  actor: string | null;
  action: string;
  target: string | null;
  details: string;
  created: number;
}
export class Audit {
  private readonly id: () => string;
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {
    this.id = createUlid({ clock: now });
    migrate(
      db,
      "audit",
      [
        {
          n: 1,
          up: (db) =>
            db.exec(`CREATE TABLE audit(id TEXT PRIMARY KEY,actor TEXT,action TEXT NOT NULL,target TEXT,details TEXT NOT NULL CHECK(json_valid(details)),created INTEGER NOT NULL) STRICT;
      CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'append-only audit'); END;
      CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'append-only audit'); END;`),
        },
      ],
      now,
    );
  }
  append(
    actor: string | null,
    action: string,
    target: string | null,
    details: unknown = {},
  ): string {
    const id = this.id();
    this.db.run(
      "INSERT INTO audit VALUES(?,?,?,?,?,?)",
      id,
      actor,
      action,
      target,
      JSON.stringify(details),
      this.now(),
    );
    return id;
  }
  list(limit = 100): AuditEntry[] {
    return this.db.all<AuditEntry>(
      "SELECT * FROM audit ORDER BY created DESC,id DESC LIMIT ?",
      limit,
    );
  }
  page(input: DiagnosticPage) {
    const total = this.db.get<{ n: number }>(
      "SELECT count(*) AS n FROM audit",
    )!.n;
    const items = this.db.all<{
      id: string;
      actor: string | null;
      action: string;
      target: string | null;
      details: string;
      created: number;
    }>(
      "SELECT * FROM audit ORDER BY created DESC,id DESC LIMIT ? OFFSET ?",
      input.limit ?? 50,
      input.offset ?? 0,
    );
    return { items, total };
  }
  exportRows(): Record<string, unknown>[] {
    return this.db.all<Record<string, unknown>>(
      "SELECT * FROM audit ORDER BY created DESC LIMIT 1000",
    );
  }
}
