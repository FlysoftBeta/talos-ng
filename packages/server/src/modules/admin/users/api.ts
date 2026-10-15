import { contract } from "@talos/contract";
import type { AdminAction } from "@talos/contract";
import type { LinkHost } from "../../../kernel/transport/link-host.ts";
import type { AdminUsers } from "./service.ts";
export function registerAdminUsersApi(
  host: LinkHost,
  service: AdminUsers,
  guard: (actor: string, action: AdminAction) => void,
): void {
  host.register(contract.admin.user.list, (ctx, args) => {
    guard(ctx.user!, "admin.user.list");
    return service.listUsers(args);
  });
  host.register(contract.admin.user.create, (ctx, args) => {
    guard(ctx.user!, "admin.user.create");
    if (args.features) guard(ctx.user!, "admin.user.features");
    return service.createUser(ctx.user!, args);
  });
  host.register(contract.admin.user.update, (ctx, args) => {
    guard(ctx.user!, "admin.user.list");
    if (args.handle !== undefined || args.name !== undefined)
      guard(ctx.user!, "admin.user.profile");
    if (args.pin !== undefined) guard(ctx.user!, "admin.user.credential");
    if (args.roles !== undefined) guard(ctx.user!, "admin.user.roles");
    if (args.features !== undefined) guard(ctx.user!, "admin.user.features");
    if (
      args.mutedUntil !== undefined ||
      args.banned !== undefined ||
      args.bannedUntil !== undefined
    )
      guard(ctx.user!, "admin.user.restrict");
    if (args.deactivated !== undefined) guard(ctx.user!, "admin.user.remove");
    return service.updateUser(ctx.user!, args);
  });
  host.register(contract.admin.user.bulk, (ctx, args) => {
    guard(ctx.user!, "admin.user.list");
    if (args.changes?.roles !== undefined || args.roleChanges)
      guard(ctx.user!, "admin.user.roles");
    if (args.changes?.features !== undefined || args.gateChanges)
      guard(ctx.user!, "admin.user.features");
    if (
      args.changes?.mutedUntil !== undefined ||
      args.changes?.banned !== undefined ||
      args.changes?.bannedUntil !== undefined
    )
      guard(ctx.user!, "admin.user.restrict");
    if (args.changes?.deactivated !== undefined)
      guard(ctx.user!, "admin.user.remove");
    return service.bulkUsers(ctx.user!, args);
  });
  host.register(contract.admin.user.purge, (ctx, args) => {
    guard(ctx.user!, "admin.user.purge");
    return service.purgeUser(ctx.user!, args.id);
  });
}
