import { AppError } from "@talos/base";
import { chat } from "@talos/contract";
import type { Audit } from "../../kernel/diagnostics/audit.ts";
import type { LinkHost } from "../../kernel/transport/link-host.ts";
import type { AuthorityService } from "../authority/index.ts";
import type { ChatService } from "./service.ts";
export function registerChatApi(
  host: LinkHost,
  service: ChatService,
  authority: AuthorityService,
  audit?: Audit,
): void {
  const access = (user: string, conversation: string): void =>
    service.requireAccess(user, conversation);
  const manager = (user: string, advanced = false): void => {
    const roles = authority.repo.actor(user)?.roles ?? [];
    if (
      !roles.includes("root") &&
      !roles.includes(
        advanced ? "advanced_community_manager" : "community_manager",
      )
    )
      throw new AppError("E_DENIED", "无权执行此管理操作");
  };
  host.register(chat.post.send, (ctx, args) => {
    service.requirePost(ctx.user!, args.conversation);
    return service.send(ctx.user!, args);
  });
  host.register(chat.post.page, (ctx, args) => {
    access(ctx.user!, args.conversation);
    return service.page(args);
  });
  host.register(chat.text.put, (ctx, args) => service.putText(ctx.user!, args));
  host.registerBody(chat.text.fetch, (ctx, args) =>
    service.textBody(ctx.user!, args),
  );
  host.registerBody(chat.post.body, (ctx, args) => {
    access(ctx.user!, service.getPost(args.id).conversation);
    return service.body(args);
  });
  host.register(chat.post.edit, (ctx, args) => {
    const post = service.getPost(args.id);
    service.requirePost(ctx.user!, post.conversation);
    if (post.author !== ctx.user)
      throw new AppError("E_DENIED", "只能编辑自己的消息");
    return service.edit(ctx.user!, args);
  });
  host.register(chat.post.delete, (ctx, args) => {
    const post = service.getPost(args.id);
    access(ctx.user!, post.conversation);
    if (post.author !== ctx.user) manager(ctx.user!);
    return service.options.uow.write(() => {
      const result = service.delete(args.id);
      if (post.author !== ctx.user)
        audit?.append(ctx.user!, "chat.post.delete", args.id);
      return result;
    });
  });
  host.register(chat.post.image, async (ctx, args) => {
    service.requirePost(ctx.user!, args.conversation);
    const authorize = (): void => {
      if (!authority.can(ctx.user!, "feature.use", { feature: "post_images" }))
        throw new AppError("E_DENIED", "没有发送图片的权限");
    };
    authorize();
    return service.image(ctx.user!, args, authorize);
  });
  host.registerBody(chat.file.fetch, async (ctx, args) => {
    if (!service.repo.stickerFile(args.rid)) {
      if (!args.conversation)
        throw new AppError("E_DENIED", "缺少文件所属对话");
      access(ctx.user!, args.conversation);
      if (!service.repo.postFile(args.conversation, args.rid))
        throw new AppError("E_NOT_FOUND", "图片不存在或消息已删除");
    }
    return service.assets.fetch(args);
  });
  host.register(chat.sticker.list, (_ctx, args) =>
    service.assets.list(args.offset, args.limit),
  );
  host.register(chat.state.set, (ctx, args) => {
    access(ctx.user!, args.conversation);
    if (ctx.op && ctx.op !== args.value.op)
      throw new AppError("E_INVALID", "操作标识不匹配");
    if (
      args.key === "retention" &&
      args.value.v !== "auto" &&
      !authority.can(ctx.user!, "feature.use", { feature: "offline" })
    )
      throw new AppError("E_DENIED", "没有离线保留权限");
    return service.setState(ctx.user!, args);
  });
  host.register(chat.state.read, (ctx, args) => {
    access(ctx.user!, args.conversation);
    return service.read(ctx.user!, args);
  });
  host.register(chat.announcement.ack, (ctx, args) =>
    service.ack(ctx.user!, args.revision),
  );
  host.register(chat.announcement.publish, (ctx, args) => {
    manager(ctx.user!, true);
    return service.options.uow.write(() => {
      const result = service.publish(args);
      audit?.append(ctx.user!, "chat.announcement.publish", "current");
      return result;
    });
  });
  host.register(chat.user.mute, (ctx, args) => {
    manager(ctx.user!);
    return service.options.uow.write(() => {
      const result = service.mute(args.user, args.until);
      audit?.append(ctx.user!, "chat.user.mute", args.user, {
        until: args.until,
      });
      return result;
    });
  });
}
