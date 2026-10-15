import { contract } from "@talos/contract";
import type { AdminAction } from "@talos/contract";
import type { LinkHost } from "../../../kernel/transport/link-host.ts";
import type { AdminPolicy } from "./service.ts";
export function registerAdminPolicyApi(
  host: LinkHost,
  service: AdminPolicy,
  guard: (actor: string, action: AdminAction) => void,
): void {
  host.register(contract.admin.device.policy.get, (ctx) => {
    guard(ctx.user!, "admin.device.policy");
    return service.settings();
  });
  host.register(contract.admin.device.policy.set, (ctx, args) => {
    guard(ctx.user!, "admin.device.policy");
    if (args.systemLock !== undefined || args.idleLock !== undefined)
      guard(ctx.user!, "admin.settings.system");
    return service.setPolicy(ctx.user!, args, ctx.device!);
  });
  host.register(contract.admin.settings.get, (ctx) => {
    guard(ctx.user!, "admin.settings.media");
    return service.settings();
  });
  host.register(contract.admin.settings.set, (ctx, args) => {
    guard(ctx.user!, "admin.settings.media");
    return service.setMediaSettings(ctx.user!, args);
  });
}
