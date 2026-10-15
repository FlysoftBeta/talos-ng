import { AppError } from "@talos/base";
import { contract } from "@talos/contract";
import type { LinkHost } from "../../kernel/transport/link-host.ts";
import type { MeService } from "./service.ts";
export function registerMeApi(host: LinkHost, service: MeService): void {
  host.register(contract.me.setting.set, (ctx, args) => {
    if (!ctx.user) throw new AppError("E_UNAUTHENTICATED", "请先登录");
    if (ctx.op && ctx.op !== args.value.op)
      throw new AppError("E_INVALID", "操作标识不匹配");
    return service.set(ctx.user, args);
  });
}
