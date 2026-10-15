import { Db, createKernel } from "@talos/server/migration";

import type { LegacyRow } from "../types.ts";
import { LegacyDb } from "../legacy/db.ts";
import { value, number, time } from "../values.ts";
import { mapId } from "../journal.ts";

export function importSettings(
  source: LegacyDb,
  target: Db,
  kernel: ReturnType<typeof createKernel>,
): void {
  const policyKey: Record<string, string> = {
    whitelist_enabled: "whitelist",
    system_locked: "system_lock",
    idle_lock_enabled: "idle_lock",
  };
  target.tx(() => {
    for (const [legacy, column] of Object.entries(policyKey)) {
      const setting = source.get<{ value: string }>(
        "SELECT value FROM config WHERE key=?",
        legacy,
      );
      if (setting)
        target.run(
          `UPDATE identity_policy SET ${column}=? WHERE id=1`,
          setting.value === "1" ? 1 : 0,
        );
    }
  });
  const content = source.get<{ value: string }>(
    "SELECT value FROM config WHERE key='announcement_content'",
  )?.value;
  if (content)
    kernel.uow.write((ctx) => {
      kernel.chat.repo.putAnnouncement(
        {
          id: "current",
          revision: Number(
            source.get<{ value: string }>(
              "SELECT value FROM config WHERE key='announcement_revision'",
            )?.value ?? 0,
          ),
          title: "公告",
          text: content.slice(0, 16000),
          published: 0,
        },
        ctx.rev,
      );
      ctx.changed("sys", "announcement", "current");
    });
  for (let offset = 0; ; offset += 500) {
    const rows = source.all<LegacyRow>(
      "SELECT id,is_muted,muted_until FROM users ORDER BY rowid LIMIT 500 OFFSET ?",
      offset,
    );
    if (!rows.length) break;
    kernel.uow.write((ctx) => {
      for (const row of rows)
        if (number(row, "is_muted")) {
          const user = mapId(target, "users", value(row, "id"));
          kernel.chat.repo.putMute(
            user,
            row.muted_until ? time(row.muted_until) : Number.MAX_SAFE_INTEGER,
            ctx.rev,
          );
          ctx.changed(`me:${user}`, "chatMute", user);
        }
    });
  }
}
