import type { Db } from "../../kernel/persistence/db.ts";
import type { WriteContext } from "../../kernel/persistence/uow.ts";
import type { PurgePorts } from "./purge.ts";
export class CommunityPurgeRepo {
  constructor(private readonly db: Db) {}
  purgeUser(user: string, ctx: WriteContext, domains: PurgePorts): void {
    const db = this.db;

    for (const row of db.all<{ conversation: string }>(
      "SELECT conversation FROM community_members WHERE user=?",
      user,
    )) {
      db.run(
        "UPDATE community_members SET deleted=1,rev=? WHERE user=? AND conversation=?",
        ctx.rev,
        user,
        row.conversation,
      );
      ctx.changed(`conv:${row.conversation}`, "communityMember", user);
      ctx.changed(`me:${user}`, "communitySelf", row.conversation);
      domains.membershipChanged(user, row.conversation, ctx);
    }
    for (const row of db.all<{ id: string }>(
      "SELECT id FROM community_conversations WHERE owner=?",
      user,
    )) {
      db.run(
        "UPDATE community_conversations SET owner=NULL,rev=? WHERE id=?",
        ctx.rev,
        row.id,
      );
      ctx.changed(`conv:${row.id}`, "communityConversation", row.id);
    }
  }
}
