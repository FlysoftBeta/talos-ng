import { contract } from "@talos/contract";
import type { AdminAction } from "@talos/contract";
import type { LinkHost } from "../../../kernel/transport/link-host.ts";
import type { AdminDiagnostics } from "./service.ts";
export function registerAdminDiagnosticsApi(
  host: LinkHost,
  service: AdminDiagnostics,
  guard: (actor: string, action: AdminAction) => void,
): void {
  host.register(contract.admin.audit.list, (ctx, args) => {
    guard(ctx.user!, "admin.audit.list");
    return service.listAudit(args);
  });
  host.register(contract.admin.incident.report, (ctx, args) => {
    service.reportClient(ctx.user!, args);
    return { ok: true as const };
  });
  host.register(contract.admin.incident.list, (ctx, args) => {
    guard(ctx.user!, "admin.incident.list");
    return service.listIncidents(args);
  });
  host.register(contract.admin.incident.detail, (ctx, args) => {
    guard(ctx.user!, "admin.incident.detail");
    return service.incidentDetail(args.id);
  });
  host.register(contract.admin.incident.download, (ctx) => {
    guard(ctx.user!, "admin.incident.download");
    return service.incidentDownload(ctx.user!);
  });
  host.register(contract.admin.performance.get, (ctx, args) => {
    guard(ctx.user!, "admin.performance");
    return service.performance(ctx.user!, args.reset);
  });
  host.register(contract.admin.incident.selfTest, (ctx, args) => {
    guard(ctx.user!, "admin.incident.selfTest");
    return service.selfTest(ctx.user!, args.source);
  });
}
