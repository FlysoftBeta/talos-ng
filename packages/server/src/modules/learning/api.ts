import { AppError, createUlid } from "@talos/base";
import { contract, LEARNING_DISCIPLINE_KEY } from "@talos/contract";
import type { LinkHost } from "../../kernel/transport/link-host.ts";
import type { SyncHub } from "../../kernel/sync/sync-hub.ts";
import type { AuthorityService } from "../authority/index.ts";
import type { MeService } from "../me/index.ts";
import type { LearningService } from "./service.ts";
export function registerLearningApi(
  host: LinkHost,
  service: LearningService,
  authority: AuthorityService,
  me: MeService,
  hub: SyncHub,
  now: () => number,
): void {
  const enabled = (user: string) =>
    authority.can(user, "feature.use", { feature: "learning" });
  const id = createUlid({ clock: now });
  service.registerSync(hub, enabled);
  host.register(contract.learning.corpus.import, (ctx, args) => {
    if (!authority.can(ctx.user!, "authority.features.set"))
      throw new AppError("E_DENIED", "只有功能管理员可以导入词库");
    return service.import(args.text);
  });
  host.register(contract.learning.answer.record, (ctx, args) => {
    if (!enabled(ctx.user!))
      throw new AppError("E_DENIED", "当前账号未获学习授权");
    if (!ctx.op || args.device !== ctx.device)
      throw new AppError("E_INVALID", "答案设备或操作标识无效");
    service.answer(ctx.user!, args);
    return { ok: true as const };
  });
  host.register(contract.learning.discipline.assign, (ctx, args) => {
    if (!authority.can(ctx.user!, "authority.features.set"))
      throw new AppError("E_DENIED", "只有功能管理员可以修改他人的自律设置");
    if (!authority.repo.actor(args.user))
      throw new AppError("E_NOT_FOUND", "用户不存在");
    const previous = me.repo.get(args.user, LEARNING_DISCIPLINE_KEY)?.value.t;
    const ms = Math.max(now(), previous?.ms ?? 0);
    me.set(args.user, {
      key: LEARNING_DISCIPLINE_KEY,
      value: {
        v: args.enabled,
        t: { ms, counter: ms === previous?.ms ? previous.counter + 1 : 0 },
        op: id(),
      },
    });
    return { ok: true as const };
  });
}
