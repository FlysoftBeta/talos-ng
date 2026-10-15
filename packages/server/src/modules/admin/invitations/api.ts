import { contract } from "@talos/contract";
import type { AdminAction } from "@talos/contract";
import type { LinkHost } from "../../../kernel/transport/link-host.ts";
import type { AdminInvitations } from "./service.ts";
export function registerAdminInvitationsApi(
  host: LinkHost,
  service: AdminInvitations,
  guard: (actor: string, action: AdminAction) => void,
): void {
  host.register(contract.admin.invitation.list, (ctx, args) => {
    guard(ctx.user!, "admin.invitation.list");
    return service.listInvitations(args);
  });
  host.register(contract.admin.invitation.revoke, (ctx, args) => {
    guard(ctx.user!, "admin.invitation.revoke");
    service.revokeInvitation(ctx.user!, args.id);
    return { ok: true as const };
  });
  host.register(contract.admin.invitation.bulkRevoke, (ctx, args) => {
    guard(ctx.user!, "admin.invitation.bulkRevoke");
    return service.bulkRevokeInvitations(ctx.user!, args.ids);
  });
}
