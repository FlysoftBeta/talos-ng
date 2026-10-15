import { AppError } from "@talos/base";
import type { AdminAction } from "@talos/contract";
import type { LinkHost } from "../../kernel/transport/link-host.ts";
import type { AuthorityPolicy } from "../authority/ports.ts";
import type { AdminService } from "./service.ts";
import { registerAdminUsersApi } from "./users/api.ts";
import { registerAdminInvitationsApi } from "./invitations/api.ts";
import { registerAdminDevicesApi } from "./devices/api.ts";
import { registerAdminPolicyApi } from "./policy/api.ts";
import { registerAdminGroupsApi } from "./groups/api.ts";
import { registerAdminAnnouncementsApi } from "./announcements/api.ts";
import { registerAdminDiagnosticsApi } from "./diagnostics/api.ts";
export function registerAdminApi(
  host: LinkHost,
  service: AdminService,
  authority: AuthorityPolicy,
): void {
  const guard = (actor: string, action: AdminAction): void => {
    if (!authority.can(actor, action))
      throw new AppError("E_DENIED", "无权执行此管理操作");
  };
  registerAdminUsersApi(host, service.users, guard);
  registerAdminInvitationsApi(host, service.invitations, guard);
  registerAdminDevicesApi(host, service.devices, guard);
  registerAdminPolicyApi(host, service.policy, guard);
  registerAdminGroupsApi(host, service.groups, guard);
  registerAdminAnnouncementsApi(host, service.announcementWorkflow, guard);
  registerAdminDiagnosticsApi(host, service.diagnostics, guard);
}
