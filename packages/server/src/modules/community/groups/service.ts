import { AppError } from "@talos/base";
import type {
  CommunityConversation,
  CommunityMember,
  CreateGroup,
} from "@talos/contract";
import { createGroupSchema } from "@talos/contract";
import type { WriteContext } from "../../../kernel/persistence/uow.ts";
import type { CommunityOptions } from "../options.ts";
import type { CommunityRepo } from "../repo.ts";
import { publicConversation } from "../repo.ts";
import { hashPassword } from "./password.ts";
export interface GroupsContext {
  repo: Pick<
    CommunityRepo,
    | "get"
    | "all"
    | "member"
    | "handle"
    | "put"
    | "updateDetails"
    | "putMember"
    | "markDeleted"
  >;
  options: Pick<CommunityOptions, "user" | "uow">;
  id: () => string;
  now: () => number;
  addMember(user: string, conversation: string, ctx: WriteContext): void;
  members(conversation: string): CommunityMember[];
  changedMembership(
    user: string,
    conversation: string,
    joined: boolean,
    ctx: WriteContext,
    notify?: boolean,
  ): void;
}
export class Groups {
  constructor(private readonly context: GroupsContext) {}
  conversation(id: string): CommunityConversation | undefined {
    const row = this.context.repo.get(id);
    return row && !row.deleted ? publicConversation(row) : undefined;
  }
  conversations(user: string): CommunityConversation[] {
    return this.context.repo
      .all()
      .filter((row) => !row.deleted && this.canAccess(user, row.id))
      .map(publicConversation);
  }
  groups(user: string): string[] {
    return this.conversations(user)
      .filter((row) => row.kind === "group")
      .map((row) => row.id);
  }
  canAccess(user: string, conversation: string): boolean {
    if (!this.context.options.user(user)) return false;
    const row = this.context.repo.get(conversation);
    return (
      !!row &&
      !row.deleted &&
      (row.type !== "normal" ||
        (!!this.context.repo.member(user, conversation) &&
          !this.context.repo.member(user, conversation)!.deleted))
    );
  }
  canPost(user: string, conversation: string): boolean {
    const row = this.conversation(conversation);
    const actor = this.context.options.user(user);
    return (
      !!row &&
      !!actor &&
      this.canAccess(user, conversation) &&
      (!row.adminOnly ||
        row.owner === user ||
        actor.roles.includes("community_manager") ||
        actor.roles.includes("root"))
    );
  }
  requireAccess(user: string, conversation: string): CommunityConversation {
    const row = this.conversation(conversation);
    if (!row) throw new AppError("E_NOT_FOUND", "对话不存在");
    if (!this.canAccess(user, conversation))
      throw new AppError("E_DENIED", "你不在该对话中");
    return row;
  }
  create(user: string, input: CreateGroup): CommunityConversation {
    const parsed = createGroupSchema.safeParse(input);
    if (!parsed.success) throw new AppError("E_INVALID", "群组资料无效");
    input = parsed.data;
    if (!this.context.options.user(user))
      throw new AppError("E_DENIED", "用户不可用");
    if (input.parent) {
      const parent = this.requireAccess(user, input.parent);
      if (parent.kind !== "group")
        throw new AppError("E_INVALID", "父级必须是群组");
    }
    const id = this.context.id();
    const handle = input.handle ?? `g-${id.toLowerCase()}`;
    if (this.context.repo.handle(handle))
      throw new AppError("E_CONFLICT", "群组标识已存在");
    const password = input.password ? hashPassword(input.password) : null;
    return this.context.options.uow.write((ctx) => {
      this.context.repo.put({
        id,
        kind: "group",
        type: "normal",
        name: input.name,
        handle,
        parent: input.parent ?? null,
        owner: user,
        discoverable: input.discoverable ? 1 : 0,
        members_hidden: input.membersHidden ? 1 : 0,
        admin_only: input.adminOnly ? 1 : 0,
        no_leave: input.noLeave ? 1 : 0,
        password_hash: password,
        pair_key: null,
        created: this.context.now(),
        rev: ctx.rev,
        deleted: 0,
      });
      this.context.addMember(user, id, ctx);
      ctx.changed(`conv:${id}`, "communityConversation", id);
      return this.conversation(id)!;
    });
  }
  adminUpdate(
    id: string,
    changes: Partial<CreateGroup> & {
      type?: "normal" | "wild" | "announcement";
    },
  ): CommunityConversation {
    const row = this.context.repo.get(id);
    if (!row || row.deleted || row.kind !== "group")
      throw new AppError("E_NOT_FOUND", "群组不存在");
    if (
      row.type !== "normal" &&
      (changes.type !== undefined || changes.parent !== undefined)
    )
      throw new AppError("E_DENIED", "系统群组不能更改类型或父级");
    if (changes.type && changes.type !== row.type)
      throw new AppError("E_DENIED", "系统群组类型由系统维护");
    if (changes.parent !== undefined && changes.parent !== null) {
      const parent = this.context.repo.get(changes.parent);
      if (!parent || parent.deleted || parent.kind !== "group")
        throw new AppError("E_NOT_FOUND", "父级群组不存在");
      let cursor: typeof parent | undefined = parent;
      while (cursor) {
        if (cursor.id === id)
          throw new AppError("E_INVALID", "群组层级不能成环");
        cursor = cursor.parent
          ? this.context.repo.get(cursor.parent)
          : undefined;
      }
    }
    if (
      changes.handle &&
      changes.handle.toLowerCase() !== row.handle.toLowerCase() &&
      this.context.repo.handle(changes.handle)
    )
      throw new AppError("E_CONFLICT", "群组标识已存在");
    return this.context.options.uow.write((ctx) => {
      this.context.repo.updateDetails(
        changes.name ?? row.name,
        changes.handle ?? row.handle,
        changes.parent === undefined ? row.parent : changes.parent,
        Number(changes.discoverable ?? !!row.discoverable),
        Number(changes.membersHidden ?? !!row.members_hidden),
        Number(changes.adminOnly ?? !!row.admin_only),
        Number(changes.noLeave ?? !!row.no_leave),
        changes.password === undefined
          ? row.password_hash
          : changes.password
            ? hashPassword(changes.password)
            : null,
        ctx.rev,
        id,
      );
      ctx.changed(`conv:${id}`, "communityConversation", id);
      return this.conversation(id)!;
    });
  }
  adminDelete(id: string): void {
    const row = this.context.repo.get(id);
    if (!row || row.deleted || row.kind !== "group")
      throw new AppError("E_NOT_FOUND", "群组不存在");
    if (row.type !== "normal")
      throw new AppError("E_DENIED", "系统群组不能删除");
    if (
      this.context.repo
        .all()
        .some((child) => !child.deleted && child.parent === id)
    )
      throw new AppError("E_CONFLICT", "请先处理子群组");
    this.context.options.uow.write((ctx) => {
      for (const member of this.context.members(id)) {
        this.context.repo.putMember({
          ...this.context.repo.member(member.user, id)!,
          deleted: 1,
          rev: ctx.rev,
        });
        this.context.changedMembership(member.user, id, false, ctx);
      }
      this.context.repo.markDeleted(ctx.rev, id);
      ctx.changed(`conv:${id}`, "communityConversation", id);
    });
  }
  find(user: string, query: string): CommunityConversation[] {
    const needle = query.trim().toLocaleLowerCase();
    return this.context.repo
      .all()
      .filter(
        (row) =>
          row.kind === "group" &&
          !row.deleted &&
          row.discoverable &&
          (!row.parent || this.canAccess(user, row.parent)) &&
          (row.name.toLocaleLowerCase().includes(needle) ||
            row.handle.toLocaleLowerCase().includes(needle)),
      )
      .map(publicConversation);
  }
  children(user: string, parent: string): CommunityConversation[] {
    this.requireAccess(user, parent);
    return this.context.repo
      .all()
      .filter((row) => row.parent === parent && !row.deleted)
      .map(publicConversation);
  }
}
