import type { ArgsOf, contract } from "@talos/contract";
import type { Db } from "../../../kernel/persistence/db.ts";
import type { Uow } from "../../../kernel/persistence/uow.ts";
import type { AuditWriter } from "../../../kernel/diagnostics/ports.ts";
import type { IdentityAdmin } from "../../identity/ports.ts";
import type { ChatAdmin } from "../../chat/ports.ts";

export interface AdminAnnouncementsOptions {
  audit: AuditWriter;
  chat: Pick<ChatAdmin, "publish" | "adminQueries">;
  db: Db;
  identity: Pick<IdentityAdmin, "directory">;
  uow: Uow;
  now?: () => number;
}
export class AdminAnnouncements {
  private readonly now: () => number;
  constructor(private readonly options: AdminAnnouncementsOptions) {
    this.now = options.now ?? Date.now;
  }
  announcements(input: ArgsOf<typeof contract.admin.announcement.list>) {
    const total = this.options.db.get<{ n: number }>(
      "SELECT count(*) AS n FROM admin_announcement_revisions",
    )!.n;
    const activeUsers = new Set(
      this.options.identity.directory.activeUserIds(this.now()),
    );
    const audience = activeUsers.size;
    const rows = this.options.db.all<{
      revision: number;
      title: string;
      text: string;
      published: number;
    }>(
      "SELECT * FROM admin_announcement_revisions ORDER BY revision DESC LIMIT ? OFFSET ?",
      input.limit ?? 50,
      input.offset ?? 0,
    );
    const acknowledgements =
      this.options.chat.adminQueries.acknowledgementCounts(
        [...activeUsers],
        rows.map((row) => row.revision),
      );
    return {
      items: rows.map((row) => ({
        id: "current" as const,
        revision: row.revision,
        title: row.title,
        text: row.text,
        published: row.published,
        acknowledged: acknowledgements.get(row.revision) ?? 0,
        audience,
      })),
      total,
    };
  }
  publishAnnouncement(
    actor: string,
    input: ArgsOf<typeof contract.admin.announcement.publish>,
  ) {
    return this.options.uow.write(() => {
      const result = this.options.chat.publish(input);
      const a = result.announcement;
      this.options.db.run(
        "INSERT INTO admin_announcement_revisions VALUES(?,?,?,?)",
        a.revision,
        a.title,
        a.text,
        a.published,
      );
      this.options.audit.append(
        actor,
        "admin.announcement.publish",
        "current",
        { revision: a.revision },
      );
      return result;
    });
  }
}
