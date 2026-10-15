import { AppError } from "@talos/base";
import type {
  CommunityConversation,
  CommunityMember,
  JoinSource,
} from "@talos/contract";
import type { WriteContext } from "../../../kernel/persistence/uow.ts";
import { checkPassword } from "../groups/password.ts";
import type { CommunityOptions } from "../options.ts";
import type { MemberRecord, CommunityRepo } from "../repo.ts";
import { publicConversation } from "../repo.ts";
export interface MembershipContext {
  options: Pick<
    CommunityOptions,
    "user" | "uow" | "users" | "onMembershipChanged"
  >;
  repo: Pick<
    CommunityRepo,
    "all" | "member" | "members" | "get" | "putMember" | "setOwner"
  >;
  conversation(id: string): CommunityConversation | undefined;
  requireAccess(user: string, conversation: string): CommunityConversation;
  canAccess(user: string, conversation: string): boolean;
  now: () => number;
}
export class Membership {
  constructor(private readonly context: MembershipContext) {}
  initializeUser(user: string): void {
    if (!this.context.options.user(user)) return;
    for (const conv of this.context.repo
      .all()
      .filter((row) => row.type !== "normal" && !row.deleted)) {
      if (!this.context.repo.member(user, conv.id))
        this.context.options.uow.write((ctx) =>
          this.addMember(user, conv.id, ctx),
        );
    }
  }
  member(user: string, conversation: string): CommunityMember | undefined {
    const record = this.context.repo.member(user, conversation);
    if (record && !record.deleted) return this.publicMember(record);
    const conv = this.context.conversation(conversation);
    if (conv && conv.type !== "normal" && this.context.options.user(user))
      return this.publicMember({
        user,
        conversation,
        hidden: 0,
        joined: conv.created,
        rev: conv.rev,
        deleted: 0,
      });
    return undefined;
  }
  members(conversation: string): CommunityMember[] {
    const conv = this.context.conversation(conversation);
    if (!conv) return [];
    return (
      conv.type !== "normal"
        ? this.context.options
            .users()
            .map((user) => this.member(user.id, conversation))
        : this.context.repo
            .members(conversation)
            .filter((row) => !row.deleted)
            .map((row) => this.publicMember(row))
    ).filter(
      (row): row is CommunityMember =>
        row !== undefined && !!this.context.options.user(row.user),
    );
  }
  visibleMembers(
    user: string,
    conversation: string,
  ): { members: CommunityMember[]; self: CommunityMember; hidden: boolean } {
    const conv = this.context.requireAccess(user, conversation);
    const self = this.member(user, conversation)!;
    const members = this.members(conversation).filter(
      (row) => row.user === user || (!conv.membersHidden && !row.hidden),
    );
    return {
      members,
      self,
      hidden:
        conv.membersHidden ||
        this.members(conversation).some((row) => row.hidden),
    };
  }
  adminMember(
    id: string,
    user: string,
    operation: "add" | "kick" | "owner",
  ): void {
    const row = this.context.repo.get(id);
    if (!row || row.deleted || row.kind !== "group")
      throw new AppError("E_NOT_FOUND", "群组不存在");
    if (row.type !== "normal" && operation === "kick")
      throw new AppError("E_DENIED", "系统群组成员不能移除");
    if (!this.context.options.user(user))
      throw new AppError("E_NOT_FOUND", "用户不存在");
    const current = this.context.repo.member(user, id);
    this.context.options.uow.write((ctx) => {
      if (operation === "kick") {
        if (!current || current.deleted)
          throw new AppError("E_NOT_FOUND", "成员不存在");
        this.context.repo.putMember({ ...current, deleted: 1, rev: ctx.rev });
        if (row.owner === user) this.context.repo.setOwner(null, ctx.rev, id);
        this.changedMembership(user, id, false, ctx);
      } else {
        if (!current || current.deleted) this.addMember(user, id, ctx);
        if (operation === "owner")
          this.context.repo.setOwner(user, ctx.rev, id);
      }
      ctx.changed(`conv:${id}`, "communityConversation", id);
    });
  }
  join(
    user: string,
    group: string,
    source: JoinSource,
    password?: string,
  ): CommunityConversation {
    if (!this.context.options.user(user))
      throw new AppError("E_DENIED", "用户不可用");
    const row = this.context.repo.get(group);
    if (!row || row.deleted || row.kind !== "group")
      throw new AppError("E_NOT_FOUND", "群组不存在");
    if (this.context.canAccess(user, group)) return publicConversation(row);
    if (
      source.type === "search"
        ? !row.discoverable ||
          (!!row.parent && !this.context.canAccess(user, row.parent))
        : row.parent !== source.group ||
          !this.context.canAccess(user, source.group)
    )
      throw new AppError("E_DENIED", "群组发现来源无效，请重新查找");
    if (
      row.password_hash &&
      (!password || !checkPassword(password, row.password_hash))
    )
      throw new AppError("E_DENIED", "群组密码不正确", { needsPassword: true });
    this.context.options.uow.write((ctx) => this.addMember(user, group, ctx));
    return publicConversation(row);
  }
  leave(user: string, group: string): void {
    const conv = this.context.requireAccess(user, group);
    if (conv.kind !== "group" || conv.noLeave || conv.type !== "normal")
      throw new AppError("E_DENIED", "此对话不能退出");
    const member = this.context.repo.member(user, group)!;
    this.context.options.uow.write((ctx) => {
      this.context.repo.putMember({ ...member, deleted: 1, rev: ctx.rev });
      this.changedMembership(user, group, false, ctx);
    });
  }
  hide(user: string, group: string, hidden: boolean): void {
    this.context.requireAccess(user, group);
    const member = this.member(user, group)!;
    if (member.hidden === hidden) return;
    this.context.options.uow.write((ctx) => {
      this.context.repo.putMember({
        conversation: group,
        user,
        hidden: hidden ? 1 : 0,
        joined: member.joined,
        rev: ctx.rev,
        deleted: 0,
      });
      this.changedMembership(user, group, true, ctx, false);
    });
  }
  publicMember(row: MemberRecord): CommunityMember {
    const user = this.context.options.user(row.user);
    return {
      user: row.user,
      conversation: row.conversation,
      name: user?.name ?? "已停用用户",
      handle: user?.handle ?? "",
      hidden: !!row.hidden,
      joined: row.joined,
      rev: row.rev,
    };
  }
  addMember(user: string, conversation: string, ctx: WriteContext): void {
    this.context.repo.putMember({
      conversation,
      user,
      hidden: 0,
      joined: this.context.now(),
      rev: ctx.rev,
      deleted: 0,
    });
    this.changedMembership(user, conversation, true, ctx);
  }
  changedMembership(
    user: string,
    conversation: string,
    joined: boolean,
    ctx: WriteContext,
    notify = true,
  ): void {
    ctx.changed(`conv:${conversation}`, "communityMember", user);
    ctx.changed(`me:${user}`, "communitySelf", conversation);
    if (notify)
      this.context.options.onMembershipChanged?.(
        user,
        conversation,
        joined,
        ctx,
      );
  }
}
