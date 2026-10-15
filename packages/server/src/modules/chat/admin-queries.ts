import type { Db } from "../../kernel/persistence/db.ts";
export class ChatAdminQueries {
  constructor(private readonly db: Db) {}
  mutes(users: readonly string[]): Map<string, number> {
    return new Map(
      this.db
        .all<{ user: string; until: number }>(
          "SELECT user,until FROM chat_mutes WHERE user IN (SELECT value FROM json_each(?))",
          JSON.stringify(users),
        )
        .map((row) => [row.user, row.until]),
    );
  }
  acknowledgementCounts(
    users: readonly string[],
    revisions: readonly number[],
  ): Map<number, number> {
    const rows = this.db.all<{ revision: number; n: number }>(
      "SELECT r.value AS revision,count(a.user) AS n FROM json_each(?) r LEFT JOIN chat_ack a ON a.revision>=r.value AND a.user IN (SELECT value FROM json_each(?)) GROUP BY r.value",
      JSON.stringify(revisions),
      JSON.stringify(users),
    );
    return new Map(rows.map((row) => [row.revision, row.n]));
  }
}
