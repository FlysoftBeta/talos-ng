import { AppError } from "@talos/base";
import type { ArgsOf, ChatAnnouncement, ChatState } from "@talos/contract";
import type { chat } from "@talos/contract";
import type { ChatOptions } from "../options.ts";
import type { ChatRepo } from "../repo.ts";
export interface ModerationContext {
  options: Pick<ChatOptions, "community" | "uow" | "identity">;
  repo: Pick<
    ChatRepo,
    | "mutedUntil"
    | "putAnnouncement"
    | "announcement"
    | "putAck"
    | "putMute"
    | "putState"
  >;
  now: () => number;
  state(user: string, conversation: string): ChatState;
}
export class Moderation {
  constructor(private readonly context: ModerationContext) {}
  requireAccess(user: string, conversation: string): void {
    if (!this.context.options.community.canAccess(user, conversation))
      throw new AppError("E_DENIED", "你没有此对话的访问权限");
  }
  requirePost(user: string, conversation: string): void {
    this.requireAccess(user, conversation);
    const until = this.context.repo.mutedUntil(user);
    if (until > this.context.now())
      throw new AppError("E_DENIED", "你已被禁言", { mutedUntil: until });
    if (!this.context.options.community.canPost(user, conversation))
      throw new AppError("E_DENIED", "此群组仅管理员可以发言");
  }
  publish(args: ArgsOf<typeof chat.announcement.publish>): {
    announcement: ChatAnnouncement;
  } {
    return this.context.options.uow.write((ctx) => {
      const announcement: ChatAnnouncement = {
        id: "current",
        revision: ctx.rev,
        title: args.title,
        text: args.text,
        published: this.context.now(),
      };
      this.context.repo.putAnnouncement(announcement, ctx.rev);
      ctx.changed("sys", "announcement", "current");
      return { announcement };
    });
  }
  ack(user: string, revision: number): { ok: true } {
    const announcement = this.context.repo.announcement();
    if (!announcement || revision > announcement.revision)
      throw new AppError("E_INVALID", "公告版本无效");
    this.context.options.uow.write((ctx) => {
      this.context.repo.putAck(user, revision, ctx.rev);
      ctx.changed(`me:${user}`, "announcementAck", "current");
    });
    return { ok: true };
  }
  mute(user: string, until: number): { ok: true } {
    if (!this.context.options.identity.active(user))
      throw new AppError("E_NOT_FOUND", "用户不存在");
    this.context.options.uow.write((ctx) => {
      this.context.repo.putMute(user, until, ctx.rev);
      for (const conversation of this.context.options.community.conversations(
        user,
      )) {
        this.context.repo.putState(
          user,
          this.context.state(user, conversation.id),
          ctx.rev,
        );
        ctx.changed(`me:${user}`, "chatState", conversation.id);
      }
    });
    return { ok: true };
  }
}
