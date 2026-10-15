import { community } from "@talos/contract";
import type { LinkHost } from "../../kernel/transport/link-host.ts";
import type { CommunityService } from "./service.ts";
export function registerCommunityApi(
  host: LinkHost,
  service: CommunityService,
): void {
  host.register(community.group.list, (ctx) =>
    service.conversations(ctx.user!),
  );
  host.register(community.group.create, (ctx, args) =>
    service.create(ctx.user!, args),
  );
  host.register(community.group.find, (ctx, args) =>
    service.find(ctx.user!, args.query),
  );
  host.register(community.group.children, (ctx, args) =>
    service.children(ctx.user!, args.group),
  );
  host.register(community.group.join, (ctx, args) =>
    service.join(ctx.user!, args.group, args.source, args.password),
  );
  host.register(community.group.leave, (ctx, args) => {
    service.leave(ctx.user!, args.group);
    return { ok: true as const };
  });
  host.register(community.group.members, (ctx, args) =>
    service.visibleMembers(ctx.user!, args.group),
  );
  host.register(community.group.hide, (ctx, args) => {
    service.hide(ctx.user!, args.group, args.hidden);
    return { ok: true as const };
  });
  host.register(community.dm.open, (ctx, args) =>
    service.openDm(ctx.user!, args.user, args.group),
  );
}
