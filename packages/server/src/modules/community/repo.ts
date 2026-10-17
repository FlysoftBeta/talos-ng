import type { CommunityConversation } from "@talos/contract";
import type { Db } from "../../kernel/persistence/db.ts";
export interface ConversationRecord {
  id: string;
  kind: "group" | "dm";
  type: "normal" | "wild" | "announcement";
  name: string;
  handle: string;
  parent: string | null;
  owner: string | null;
  discoverable: number;
  members_hidden: number;
  admin_only: number;
  no_leave: number;
  password_hash: string | null;
  pair_key: string | null;
  created: number;
  rev: number;
  deleted: number;
}
export interface MemberRecord {
  conversation: string;
  user: string;
  hidden: number;
  joined: number;
  rev: number;
  deleted: number;
}
export function publicConversation(
  row: ConversationRecord,
): CommunityConversation {
  return {
    id: row.id,
    kind: row.kind,
    type: row.type,
    name: row.name,
    handle: row.handle,
    parent: row.parent,
    owner: row.owner,
    discoverable: !!row.discoverable,
    membersHidden: !!row.members_hidden,
    adminOnly: !!row.admin_only,
    noLeave: !!row.no_leave,
    passwordRequired: row.password_hash !== null,
    created: row.created,
    rev: row.rev,
  };
}
export class CommunityRepo {
  constructor(private readonly db: Db) {}
  updateDetails(
    name: string,
    handle: string,
    parent: string | null,
    discoverable: number,
    membersHidden: number,
    adminOnly: number,
    noLeave: number,
    passwordHash: string | null,
    rev: number,
    id: string,
  ): void {
    this.db.run(
      "UPDATE community_conversations SET name=?,handle=?,parent=?,discoverable=?,members_hidden=?,admin_only=?,no_leave=?,password_hash=?,rev=? WHERE id=?",
      name,
      handle,
      parent,
      discoverable,
      membersHidden,
      adminOnly,
      noLeave,
      passwordHash,
      rev,
      id,
    );
  }
  markDeleted(rev: number, id: string): void {
    this.db.run(
      "UPDATE community_conversations SET deleted=1,rev=? WHERE id=?",
      rev,
      id,
    );
  }
  setOwner(owner: string | null, rev: number, id: string): void {
    this.db.run(
      "UPDATE community_conversations SET owner=?,rev=? WHERE id=?",
      owner,
      rev,
      id,
    );
  }
  get(id: string): ConversationRecord | undefined {
    return this.db.get("SELECT * FROM community_conversations WHERE id=?", id);
  }
  all(): ConversationRecord[] {
    return this.db.all("SELECT * FROM community_conversations ORDER BY rev,id");
  }
  /** Live conversations the user may read: system ones plus live memberships. */
  accessible(user: string): ConversationRecord[] {
    return this.db.all(
      `SELECT c.* FROM community_members m JOIN community_conversations c ON c.id=m.conversation
       WHERE m.user=? AND m.deleted=0 AND c.deleted=0 AND c.type='normal'
       UNION ALL
       SELECT * FROM community_conversations WHERE type IN('wild','announcement') AND deleted=0
       ORDER BY rev,id`,
      user,
    );
  }
  systemConversations(): ConversationRecord[] {
    return this.db.all(
      "SELECT * FROM community_conversations WHERE type IN('wild','announcement') AND deleted=0 ORDER BY rev,id",
    );
  }
  handle(handle: string): ConversationRecord | undefined {
    return this.db.get(
      "SELECT * FROM community_conversations WHERE handle=? COLLATE NOCASE",
      handle,
    );
  }
  pair(key: string): ConversationRecord | undefined {
    return this.db.get(
      "SELECT * FROM community_conversations WHERE pair_key=?",
      key,
    );
  }
  put(row: ConversationRecord): void {
    this.db.run(
      "INSERT INTO community_conversations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      row.id,
      row.kind,
      row.type,
      row.name,
      row.handle,
      row.parent,
      row.owner,
      row.discoverable,
      row.members_hidden,
      row.admin_only,
      row.no_leave,
      row.password_hash,
      row.pair_key,
      row.created,
      row.rev,
      row.deleted,
    );
  }
  member(user: string, conversation: string): MemberRecord | undefined {
    return this.db.get(
      "SELECT * FROM community_members WHERE user=? AND conversation=?",
      user,
      conversation,
    );
  }
  /** One revision-ordered page of a conversation's member records. */
  membersAfter(
    conversation: string,
    since: number,
    limit: number,
  ): MemberRecord[] {
    return this.db.all(
      "SELECT * FROM community_members WHERE conversation=? AND rev>? ORDER BY rev,user LIMIT ?",
      conversation,
      since,
      limit,
    );
  }
  members(conversation: string): MemberRecord[] {
    return this.db.all(
      "SELECT * FROM community_members WHERE conversation=? ORDER BY rev,user",
      conversation,
    );
  }
  memberships(user: string): MemberRecord[] {
    return this.db.all(
      "SELECT * FROM community_members WHERE user=? ORDER BY rev,conversation",
      user,
    );
  }
  putMember(row: MemberRecord): void {
    this.db.run(
      "INSERT INTO community_members VALUES(?,?,?,?,?,?) ON CONFLICT(conversation,user) DO UPDATE SET hidden=excluded.hidden,joined=excluded.joined,rev=excluded.rev,deleted=excluded.deleted",
      row.conversation,
      row.user,
      row.hidden,
      row.joined,
      row.rev,
      row.deleted,
    );
  }
}
