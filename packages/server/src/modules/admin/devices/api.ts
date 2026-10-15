import { contract } from "@talos/contract";
import type { AdminAction } from "@talos/contract";
import type { LinkHost } from "../../../kernel/transport/link-host.ts";
import type { AdminDevices } from "./service.ts";
export function registerAdminDevicesApi(
  host: LinkHost,
  service: AdminDevices,
  guard: (actor: string, action: AdminAction) => void,
): void {
  host.register(contract.admin.device.list, (ctx, args) => {
    guard(ctx.user!, "admin.device.list");
    return service.listDevices(args);
  });
  host.register(contract.admin.device.update, (ctx, args) => {
    guard(ctx.user!, "admin.device.update");
    return service.updateDevice(ctx.user!, args, ctx.device!);
  });
  host.register(contract.admin.device.delete, (ctx, args) => {
    guard(ctx.user!, "admin.device.delete");
    service.deleteDevice(ctx.user!, args.id, ctx.device!);
    return { ok: true as const };
  });
}
