import { AppError } from "@talos/base";
import { createHash } from "node:crypto";
import type { ArgsOf, contract } from "@talos/contract";
import type { Db } from "../../../kernel/persistence/db.ts";
import type {
  AuditQueries,
  AuditWriter,
} from "../../../kernel/diagnostics/ports.ts";
import type { IncidentDiagnostics } from "../../../kernel/diagnostics/ports.ts";
import type { TicketService } from "../../../kernel/objects/tickets.ts";
import { diagnosticZip } from "./zip.ts";

export interface AdminDiagnosticsOptions {
  audit: AuditWriter & AuditQueries;
  db: Db;
  incidents: IncidentDiagnostics;
  serverLogs?: () => string;
  tickets: TicketService;
  now?: () => number;
}
export class AdminDiagnostics {
  private readonly now: () => number;
  constructor(private readonly options: AdminDiagnosticsOptions) {
    this.now = options.now ?? Date.now;
  }
  listAudit(input: ArgsOf<typeof contract.admin.audit.list>) {
    return this.options.audit.page(input);
  }
  listIncidents(input: ArgsOf<typeof contract.admin.incident.list>) {
    return this.options.incidents.page(input);
  }
  incidentDetail(id: string) {
    return this.options.incidents.detail(id);
  }
  incidentDownload(user: string) {
    const rows = this.options.incidents.exportRows();
    const audit = this.options.audit.exportRows();
    const bytes = diagnosticZip(
      "diagnostics.json",
      new TextEncoder().encode(
        JSON.stringify(
          {
            build: this.options.incidents.build,
            serverLogs: this.options.serverLogs?.() ?? "",
            incidents: rows,
            audit,
          },
          null,
          2,
        ),
      ),
    );
    const objectId = createHash("sha256").update(bytes).digest("hex");
    this.options.db.run(
      "INSERT OR REPLACE INTO admin_downloads VALUES(?,?,?)",
      objectId,
      user,
      this.now() + 300_000,
    );
    this.options.audit.append(user, "admin.incident.download", null, {
      incidents: rows.length,
      audit: audit.length,
    });
    return this.options.tickets.issue({
      user,
      objectId,
      filename: "diagnostics.zip",
      mime: "application/zip",
      source: {
        size: bytes.length,
        read: async function* () {
          yield bytes;
        },
      },
    });
  }
  selfTest(
    actor: string,
    source: "server" | "client" = "server",
  ): { id: string } {
    if (source === "client")
      throw new AppError("E_INVALID", "请在浏览器执行客户端自检");
    this.options.audit.append(actor, "admin.incident.selfTest", null, {
      source,
    });
    throw new Error("Admin server diagnostic self-test");
  }
  reportClient(
    actor: string,
    input: ArgsOf<typeof contract.admin.incident.report>,
  ): void {
    const error = new Error();
    error.name = input.name;
    error.stack = `Error\n${input.stack}`;
    this.options.incidents.report(error, {
      source: "client",
      build: input.build,
      environment: input.environment,
      method: `client.${input.kind}`,
      relatedIds: [actor],
    });
  }
}
