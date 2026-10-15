import { contract } from "@talos/contract";
import type { AdminAction } from "@talos/contract";
import type { LinkHost } from "../../../kernel/transport/link-host.ts";
import type { AdminGroups } from "./service.ts";
export function registerAdminGroupsApi(
  host: LinkHost,
  service: AdminGroups,
  guard: (actor: string, action: AdminAction) => void,
): void {
  host.register(contract.admin.group.list, (ctx, args) => {
    guard(ctx.user!, "admin.group.list");
    return service.listGroups(args);
  });
  host.register(contract.admin.group.create, (ctx, args) => {
    guard(ctx.user!, "admin.group.edit");
    return service.createGroup(ctx.user!, args);
  });
  host.register(contract.admin.group.update, (ctx, args) => {
    guard(ctx.user!, "admin.group.edit");
    return service.updateGroup(ctx.user!, args);
  });
  host.register(contract.admin.group.delete, (ctx, args) => {
    guard(ctx.user!, "admin.group.edit");
    service.deleteGroup(ctx.user!, args.id, args.name);
    return { ok: true as const };
  });
  host.register(contract.admin.group.members, (ctx, args) => {
    guard(ctx.user!, "admin.group.members");
    return service.groupMembers(args.id);
  });
  host.register(contract.admin.group.member, (ctx, args) => {
    guard(ctx.user!, "admin.group.members");
    service.changeGroupMember(ctx.user!, args);
    return { ok: true as const };
  });
}
