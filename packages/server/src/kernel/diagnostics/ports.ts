import type { Audit } from "./audit.ts";
import type { Incidents } from "./incidents.ts";
export interface DiagnosticPage {
  offset?: number;
  limit?: number;
}
export interface IncidentQuery extends DiagnosticPage {
  source?: "client" | "server";
  build?: string;
  environment?: string;
  level?: string;
  module?: string;
  from?: number;
  to?: number;
  query?: string;
}
export type AuditWriter = Pick<Audit, "append">;
export type AuditQueries = Pick<Audit, "page" | "exportRows">;
export type IncidentDiagnostics = Pick<
  Incidents,
  "page" | "detail" | "exportRows" | "report" | "build"
>;
