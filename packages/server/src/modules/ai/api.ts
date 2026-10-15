import { AppError } from "@talos/base";
import { ai } from "@talos/contract";
import type { Audit } from "../../kernel/diagnostics/audit.ts";
import type { LinkHost } from "../../kernel/transport/link-host.ts";
import type { AuthorityService } from "../authority/index.ts";
import type { AiService } from "./service.ts";
export function registerAiApi(
  host: LinkHost,
  service: AiService,
  authority: AuthorityService,
  audit: Audit,
): void {
  const user = (id: string): string => {
    if (!authority.can(id, "feature.use", { feature: "ai" }))
      throw new AppError("E_DENIED", "当前账号未获 AI 授权");
    return id;
  };
  const admin = (id: string): void => {
    if (!authority.can(id, "authority.features.set"))
      throw new AppError("E_DENIED", "只有功能管理员可以管理 AI 额度");
  };
  host.register(ai.text.put, (ctx, a) => service.putText(user(ctx.user!), a));
  host.registerBody(ai.content.fetch, (ctx, a) =>
    service.content(user(ctx.user!), a.kind, a.id, a.offset),
  );
  host.register(ai.conversation.create, (ctx, a) =>
    service.create(user(ctx.user!), a.title),
  );
  host.register(ai.conversation.update, (ctx, a) =>
    service.update(user(ctx.user!), a),
  );
  host.register(ai.conversation.fork, (ctx, a) =>
    service.fork(user(ctx.user!), a.message),
  );
  host.register(ai.conversation.read, (ctx, a) =>
    service.read(user(ctx.user!), a.id, a.seq),
  );
  host.register(ai.message.page, (ctx, a) => service.page(user(ctx.user!), a));
  host.register(ai.draft.set, (ctx, a) => {
    if (ctx.op && ctx.op !== a.value.op)
      throw new AppError("E_INVALID", "操作标识不匹配");
    return service.draft(user(ctx.user!), a);
  });
  host.register(ai.run.start, (ctx, a) => service.start(user(ctx.user!), a));
  host.register(ai.run.stop, (ctx, a) => service.stop(user(ctx.user!), a.id));
  host.register(ai.account.get, (ctx) =>
    service.options.uow.write((write) =>
      service.billing.project(user(ctx.user!), write),
    ),
  );
  host.register(ai.workspace.list, (ctx) =>
    service.workspace.list(user(ctx.user!)),
  );
  host.register(ai.workspace.read, (ctx, a) =>
    service.workspace.read(user(ctx.user!), a.path),
  );
  host.register(ai.workspace.write, (ctx, a) => {
    user(ctx.user!);
    let content = a.content;
    if (a.textId) {
      const staged = service.repo.text(ctx.user!, a.textId);
      if (!staged || staged.content.length !== staged.total)
        throw new AppError("E_CONFLICT", "文件尚未上传完整");
      content = staged.content;
    }
    return service.workspace.write(ctx.user!, a.path, content, a.expected);
  });
  host.register(ai.workspace.delete, (ctx, a) =>
    service.workspace.delete(user(ctx.user!), a.path, a.expected),
  );
  host.register(ai.workspace.image, (ctx, a) =>
    service.image(user(ctx.user!), a.upload, a.mime),
  );
  host.register(ai.admin.users, (ctx, a) => {
    admin(ctx.user!);
    const query = a.query.trim().toLocaleLowerCase();
    return authority.repo
      .users()
      .map((id) => authority.repo.actor(id)!)
      .filter((u) =>
        `${u.name} ${u.handle}`.toLocaleLowerCase().includes(query),
      )
      .slice(0, 50)
      .map((u) => ({ id: u.id, name: u.name, handle: u.handle }));
  });
  host.register(ai.admin.stats, (ctx) => {
    admin(ctx.user!);
    return service.repo.stats(service.options.now());
  });
  host.register(ai.admin.account, (ctx, a) => {
    admin(ctx.user!);
    return service.billing.account(a.user);
  });
  host.register(ai.admin.assign, (ctx, a) => {
    admin(ctx.user!);
    if (!authority.repo.actor(a.user))
      throw new AppError("E_NOT_FOUND", "用户不存在");
    return service.options.uow.write(() => {
      const result = service.billing.assign(a);
      audit.append(ctx.user!, "ai.admin.assign", a.user, {
        amount: a.amount,
        days: a.days,
        key: a.key,
      });
      return result;
    });
  });
  host.register(ai.admin.policy, (ctx, a) => {
    admin(ctx.user!);
    return service.options.uow.write(() => {
      const result = service.billing.policy(a, authority.repo.users());
      audit.append(ctx.user!, "ai.admin.policy", "policy");
      return result;
    });
  });
}
