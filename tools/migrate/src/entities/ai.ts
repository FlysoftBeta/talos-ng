import { AppError } from "@talos/base";
import { Db } from "@talos/server/migration";

import type { LegacyRow } from "../types.ts";
import { value, number, time } from "../values.ts";
import { rev, mapId } from "../journal.ts";
import type { LegacyDb } from "../legacy/db.ts";

export function importAi(
  target: Db,
  table: string,
  row: LegacyRow,
  legacyId: string,
): string {
  const id = mapId(target, table, legacyId);
  const r = rev(target);
  const user = (key: string): string => mapId(target, "users", value(row, key));
  const hasUser = (id: string): boolean =>
    !!target.get("SELECT 1 FROM users WHERE id=?", id);
  switch (table) {
    case "ai_conversations": {
      const u = user("user_id");
      if (!hasUser(u))
        throw new AppError("E_INVALID", "orphan AI conversation");
      const body = {
        id,
        title: value(row, "title"),
        tags: [],
        lastSeq: number(row, "last_assistant_sequence"),
        readSeq: number(row, "last_read_assistant_sequence"),
        running: null,
        updated: time(row.updated_at),
      };
      target.run(
        "INSERT INTO ai_rows VALUES(?,?,?,?,?,0)",
        u,
        "aiConversation",
        id,
        JSON.stringify(body),
        r,
      );
      break;
    }
    case "ai_messages": {
      const conversation = mapId(
        target,
        "ai_conversations",
        value(row, "conversation_id"),
      );
      const parent = target.get<{ user: string }>(
        "SELECT user FROM ai_rows WHERE type=? AND id=?",
        "aiConversation",
        conversation,
      );
      if (!parent) throw new AppError("E_INVALID", "orphan AI message");
      const status = value(row, "status");
      const body = {
        id,
        conversation,
        // Legacy `sequence` is global; the target sequence is dense per conversation.
        seq: target.get<{ n: number }>(
          "SELECT coalesce(max(seq),0)+1 n FROM ai_messages WHERE conversation=?",
          conversation,
        )!.n,
        rev: r,
        role: value(row, "role"),
        text: value(row, "content"),
        images: [],
        status:
          status === "completed"
            ? "done"
            : status === "pending"
              ? "cancelled"
              : status === "streaming"
                ? "failed"
                : status,
        created: time(row.created_at),
        error: ["pending", "streaming"].includes(status)
          ? "Legacy run stopped during migration; partial text retained"
          : null,
      };
      target.run(
        "INSERT INTO ai_messages VALUES(?,?,?,?,?,?,0)",
        id,
        parent.user,
        conversation,
        body.seq,
        JSON.stringify(body),
        r,
      );
      break;
    }
    case "ai_credit_accounts":
      if (hasUser(user("user_id")))
        target.run(
          "INSERT OR REPLACE INTO ai_accounts VALUES(?,?,0)",
          user("user_id"),
          number(row, "top_up_credit_micros"),
        );
      if (number(row, "reserved_credit_micros"))
        target.run(
          "INSERT OR IGNORE INTO ai_ledger VALUES(?,?,?,?,?,?,?)",
          mapId(target, "migration-reservation-account", legacyId),
          user("user_id"),
          "release",
          0,
          `Migration released ${number(row, "reserved_credit_micros")} reserved microcredits; no charge, top-up balance unchanged`,
          time(row.updated_at),
          `migration-reservation-account:${legacyId}`,
        );
      break;
    case "ai_credit_reservations":
      if (value(row, "status") === "active")
        target.run(
          "INSERT OR IGNORE INTO ai_ledger VALUES(?,?,?,?,?,?,?)",
          id,
          user("user_id"),
          "release",
          0,
          `Migration settled active reservation ${value(row, "operation_id")} of ${number(row, "amount_credit_micros")} microcredits to zero; legacy run not resumed`,
          time(row.updated_at),
          `migration-reservation:${legacyId}`,
        );
      break;
    case "ai_plan_enrollments":
      if (hasUser(user("user_id")))
        target.run(
          "INSERT INTO ai_accounts VALUES(?,0,?) ON CONFLICT(user) DO UPDATE SET plan_ends=excluded.plan_ends",
          user("user_id"),
          time(row.ends_at),
        );
      break;
    case "ai_credit_ledger":
      if (hasUser(user("user_id")))
        target.run(
          "INSERT OR IGNORE INTO ai_ledger VALUES(?,?,?,?,?,?,?)",
          id,
          user("user_id"),
          value(row, "kind"),
          number(row, "delta_credit_micros"),
          value(row, "note"),
          time(row.created_at),
          value(row, "idempotency_key") || legacyId,
        );
      break;
    case "ai_workspaces":
      target.run(
        "INSERT OR REPLACE INTO migration_workspace_rows(legacy_id,user_id,blob_id) VALUES(?,?,?)",
        legacyId,
        user("user_id"),
        value(row, "blob_id"),
      );
      break;
  }
  return id;
}

/**
 * Conversation sequence fields refer to legacy global sequences. After all messages are imported, map each to the
 * dense sequence of the newest imported message at or before it. Reads the source only, so reruns give the same result.
 */
export function remapAiSequences(source: LegacyDb, target: Db): void {
  const convs = source.all<LegacyRow>(
    "SELECT id,last_assistant_sequence l,last_read_assistant_sequence r FROM ai_conversations",
  );
  const dense = (conversation: string, legacy: number): number => {
    if (legacy <= 0) return 0;
    for (const m of source.all<LegacyRow>(
      "SELECT id FROM ai_messages WHERE conversation_id=? AND sequence<=? ORDER BY sequence DESC",
      String(conversation),
      legacy,
    )) {
      const seq = target.get<{ seq: number }>(
        "SELECT seq FROM ai_messages WHERE id=?",
        mapId(target, "ai_messages", String(m.id)),
      )?.seq;
      if (seq) return seq;
    }
    return 0;
  };
  target.tx(() => {
    for (const c of convs) {
      const id = mapId(target, "ai_conversations", String(c.id));
      target.run(
        "UPDATE ai_rows SET data=json_set(data,'$.lastSeq',?,'$.readSeq',?) WHERE type='aiConversation' AND id=?",
        dense(String(c.id), Number(c.l)),
        dense(String(c.id), Number(c.r)),
        id,
      );
    }
  });
}
