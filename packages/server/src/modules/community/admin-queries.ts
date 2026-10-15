import type { AdminGroup } from "@talos/contract";
import type { Db } from "../../kernel/persistence/db.ts";
interface GroupRow {
  id: string;
  handle: string;
  name: string;
  type: string;
  member_count: number;
  parent: string | null;
  owner: string | null;
  discoverable: number;
  members_hidden: number;
  admin_only: number;
  no_leave: number;
  password_hash: string | null;
}
export class CommunityAdminDirectory {
  constructor(private readonly db: Db) {}
  groups(
    query: string,
    offset: number,
    limit: number,
  ): { items: AdminGroup[]; total: number } {
    const q = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const where =
      "WHERE (g.handle LIKE ? ESCAPE '\\' OR g.name LIKE ? ESCAPE '\\') AND g.kind='group' AND g.deleted=0";
    const total = this.db.get<{ n: number }>(
      `SELECT count(*) AS n FROM community_conversations g ${where}`,
      q,
      q,
    )!.n;
    const rows = this.db.all<GroupRow>(
      `SELECT g.id,g.handle,g.name,g.type,g.parent,g.owner,g.discoverable,g.members_hidden,g.admin_only,g.no_leave,g.password_hash,(SELECT count(*) FROM community_members m WHERE m.conversation=g.id AND m.deleted=0) AS member_count FROM community_conversations g ${where} ORDER BY g.name COLLATE NOCASE,g.id LIMIT ? OFFSET ?`,
      q,
      q,
      limit,
      offset,
    );
    return {
      items: rows.map((row) => this.mapGroup(row)),
      total,
    };
  }
  group(id: string): AdminGroup | undefined {
    const row = this.db.get<GroupRow>(
      "SELECT g.id,g.handle,g.name,g.type,g.parent,g.owner,g.discoverable,g.members_hidden,g.admin_only,g.no_leave,g.password_hash,(SELECT count(*) FROM community_members m WHERE m.conversation=g.id AND m.deleted=0) AS member_count FROM community_conversations g WHERE g.id=? AND g.kind='group' AND g.deleted=0",
      id,
    );
    return row ? this.mapGroup(row) : undefined;
  }
  private mapGroup(r: GroupRow): AdminGroup {
    return {
      id: r.id,
      handle: r.handle,
      name: r.name,
      type: r.type,
      memberCount: r.member_count,
      parent: r.parent,
      owner: r.owner,
      discoverable: !!r.discoverable,
      membersHidden: !!r.members_hidden,
      adminOnly: !!r.admin_only,
      noLeave: !!r.no_leave,
      passwordRequired: r.password_hash !== null,
    };
  }
}
