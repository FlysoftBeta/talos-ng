import { AppError } from "@talos/base";
import type { CommunityConversation, CommunityMember } from "@talos/contract";
import type { WriteContext } from "../../../kernel/persistence/uow.ts";
import type { CommunityOptions } from "../options.ts";
import type { CommunityRepo } from "../repo.ts";
import { publicConversation } from "../repo.ts";
export interface DirectMessagesContext {
  requireAccess(user: string, conversation: string): CommunityConversation;
  canAccess(user: string, conversation: string): boolean;
  visibleMembers(
    user: string,
    conversation: string,
  ): { members: CommunityMember[]; self: CommunityMember; hidden: boolean };
  repo: Pick<CommunityRepo, "pair" | "put">;
  id: () => string;
  options: Pick<CommunityOptions, "uow" | "user">;
  now: () => number;
  addMember(user: string, conversation: string, ctx: WriteContext): void;
  conversation(id: string): CommunityConversation | undefined;
}
export class DirectMessages {
  constructor(private readonly context: DirectMessagesContext) {}
  openDm(user: string, peer: string, group: string): CommunityConversation {
    if (user === peer) throw new AppError("E_INVALID", "不能与自己私聊");
    const proof = this.context.requireAccess(user, group);
    if (
      proof.kind !== "group" ||
      !this.context.canAccess(peer, group) ||
      !this.context
        .visibleMembers(user, group)
        .members.some((member) => member.user === peer)
    )
      throw new AppError("E_DENIED", "需要可见的共同群组成员作为私聊来源");
    const pair = [user, peer].sort().join(":");
    const existing = this.context.repo.pair(pair);
    if (existing && !existing.deleted) return publicConversation(existing);
    const id = this.context.id();
    return this.context.options.uow.write((ctx) => {
      this.context.repo.put({
        id,
        kind: "dm",
        type: "normal",
        name: [
          this.context.options.user(user)!.name,
          this.context.options.user(peer)!.name,
        ].join(" · "),
        handle: `dm-${id.toLowerCase()}`,
        parent: null,
        owner: null,
        discoverable: 0,
        members_hidden: 0,
        admin_only: 0,
        no_leave: 1,
        password_hash: null,
        pair_key: pair,
        created: this.context.now(),
        rev: ctx.rev,
        deleted: 0,
      });
      this.context.addMember(user, id, ctx);
      this.context.addMember(peer, id, ctx);
      ctx.changed(`conv:${id}`, "communityConversation", id);
      return this.context.conversation(id)!;
    });
  }
}
