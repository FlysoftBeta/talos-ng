import { contract } from "@talos/contract";
import type { AdminAction } from "@talos/contract";
import type { LinkHost } from "../../../kernel/transport/link-host.ts";
import type { AdminAnnouncements } from "./service.ts";
export function registerAdminAnnouncementsApi(
  host: LinkHost,
  service: AdminAnnouncements,
  guard: (actor: string, action: AdminAction) => void,
): void {
  host.register(contract.admin.announcement.list, (ctx, args) => {
    guard(ctx.user!, "admin.announcement.list");
    return service.announcements(args);
  });
  host.register(contract.admin.announcement.publish, (ctx, args) => {
    guard(ctx.user!, "admin.announcement.publish");
    return service.publishAnnouncement(ctx.user!, args);
  });
}
