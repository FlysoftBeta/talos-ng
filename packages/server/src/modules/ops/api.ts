import { AppError } from "@talos/base";
import type { OpsAction } from "@talos/contract";
import { contract } from "@talos/contract";
import type { Audit } from "../../kernel/diagnostics/audit.ts";
import type {
  LinkHost,
  RequestContext,
} from "../../kernel/transport/link-host.ts";
import type { AuthorityService } from "../authority/index.ts";
import type { OpsService } from "./service.ts";
export function registerOpsApi(
  host: LinkHost,
  service: OpsService,
  authority: AuthorityService,
  audit: Audit,
): void {
  const auth = (ctx: RequestContext, action: OpsAction): string => {
    if (!ctx.user) throw new AppError("E_UNAUTHENTICATED", "请先登录");
    if (!authority.can(ctx.user, action))
      throw new AppError("E_DENIED", "当前账号未获授权");
    return ctx.user;
  };
  const ok = { ok: true as const };
  host.register(contract.ops.settings.get, (ctx) => {
    auth(ctx, "ops.settings.get");
    return service.repo.settings();
  });
  host.register(contract.ops.settings.set, (ctx, args) => {
    const actor = auth(ctx, "ops.settings.set");
    if (args.manifestUrl && !/^https:\/\//.test(args.manifestUrl))
      throw new AppError("E_INVALID", "云端地址必须使用 HTTPS");
    audit.append(actor, "ops.settings.set", null);
    return service.repo.saveSettings(args);
  });
  host.register(contract.ops.backup.list, (ctx) => {
    auth(ctx, "ops.backup.list");
    return service.repo.backups();
  });
  host.register(contract.ops.backup.create, (ctx) => {
    const actor = auth(ctx, "ops.backup.create");
    audit.append(actor, "ops.backup.create", null);
    return service.backups.create();
  });
  host.register(contract.ops.backup.delete, async (ctx, args) => {
    const actor = auth(ctx, "ops.backup.delete");
    audit.append(actor, "ops.backup.delete", args.id);
    await service.backups.delete(args.id);
    return ok;
  });
  host.register(contract.ops.backup.download, (ctx, args) =>
    service.backupDownload(auth(ctx, "ops.backup.download"), args.id),
  );
  host.register(contract.ops.update.status, (ctx) => {
    auth(ctx, "ops.update.status");
    return service.updates.status();
  });
  host.register(contract.ops.update.stage, (ctx, args) => {
    const actor = auth(ctx, "ops.update.stage");
    audit.append(actor, "ops.update.stage", args.upload);
    return service.stageUpload(actor, args.upload);
  });
  host.register(contract.ops.update.apply, (ctx) => {
    const actor = auth(ctx, "ops.update.apply");
    audit.append(actor, "ops.update.apply", null);
    ctx.afterReply(service.updates.apply());
    return ok;
  });
  host.register(contract.ops.update.confirm, (ctx) => {
    const actor = auth(ctx, "ops.update.confirm");
    audit.append(actor, "ops.update.confirm", null);
    service.updates.confirm();
    return ok;
  });
  host.register(contract.ops.update.check, (ctx) => {
    auth(ctx, "ops.update.check");
    return service.updates.check();
  });
  host.register(contract.ops.update.install, (ctx) => {
    const actor = auth(ctx, "ops.update.install");
    audit.append(actor, "ops.update.install", null);
    return service.updates.install();
  });
  host.register(contract.ops.https.status, (ctx) => {
    auth(ctx, "ops.https.status");
    return service.https();
  });
  const hostStatus = () => ({
    available: service.host.available,
    shutdownAt: service.host.shutdownAt(),
  });
  host.register(contract.ops.host.status, (ctx) => {
    auth(ctx, "ops.host.status");
    return hostStatus();
  });
  host.register(contract.ops.host.run, async (ctx, args) => {
    const actor = auth(ctx, "ops.host.run");
    audit.append(
      actor,
      "ops.host.run",
      args.action === "shutdown"
        ? `shutdown:${args.delayMinutes}`
        : args.action,
    );
    await service.host.run(args);
    return hostStatus();
  });
  host.register(contract.ops.office.list, (ctx) => {
    auth(ctx, "ops.office.list");
    return service.listOffice();
  });
  host.register(contract.ops.office.refresh, (ctx) => {
    const actor = auth(ctx, "ops.office.refresh");
    audit.append(actor, "ops.office.refresh", null);
    return service.refreshOffice(true);
  });
  host.register(contract.ops.office.clear, (ctx) => {
    const actor = auth(ctx, "ops.office.clear");
    audit.append(actor, "ops.office.clear", null);
    service.clearOffice();
    return ok;
  });
  host.register(contract.ops.office.download, (ctx, args) =>
    service.officeDownload(auth(ctx, "ops.office.download"), args.id),
  );
}
