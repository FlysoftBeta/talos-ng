import { AppError } from "@talos/base";
import { contract } from "@talos/contract";
import type { LinkHost } from "../../kernel/transport/link-host.ts";
import type { AuthorityService } from "./service.ts";
export function registerAuthorityApi(
  host: LinkHost,
  service: AuthorityService,
): void {
  host.register(contract.authority.access.set, (ctx, args) => {
    if (
      (args.roles && !service.can(ctx.user!, "authority.roles.set")) ||
      (args.features && !service.can(ctx.user!, "authority.features.set"))
    )
      throw new AppError("E_DENIED", "无权修改此权限");
    service.setAccess(args.user, args);
    return { ok: true as const };
  });
  host.register(contract.authority.grant.set, (ctx, args) => {
    if (!service.can(ctx.user!, "resource.own", { id: args.resource }))
      throw new AppError("E_DENIED", "只有资源所有者可以分享");
    service.setGrant(args);
    return { ok: true as const };
  });
}
