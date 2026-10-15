import { AppError } from "@talos/base";
import { Db } from "@talos/server/migration";

import type { LegacyRow } from "../types.ts";
import { value, number, time, json } from "../values.ts";
import { rev, legacyUlid, mapId } from "../journal.ts";

export function importChat(
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
    case "posts": {
      const conv = value(row, "conv_id")
        .replace(/^group:/, "")
        .replace(/^dm:/, "");
      const c = mapId(
        target,
        value(row, "conv_id").startsWith("dm:") ? "dms" : "groups",
        conv,
      );
      if (!target.get("SELECT 1 FROM community_conversations WHERE id=?", c))
        throw new AppError("E_INVALID", "orphan post");
      const author = user("author_id");
      const text = value(row, "brief");
      const content = json(row.content_json, {});
      if ((content as { type?: string }).type === "sticker") {
        const sticker = content as {
          sticker_pack?: string;
          sticker_id?: string;
        };
        target.run(
          "INSERT OR REPLACE INTO migration_sticker_refs(post_id,pack,sticker_id) VALUES(?,?,?)",
          id,
          sticker.sticker_pack ?? "",
          sticker.sticker_id ?? "",
        );
      }
      const data = {
        id,
        conversation: c,
        seq: number(row, "sequence", r),
        rev: r,
        author: hasUser(author) ? author : legacyUlid("users", "deleted"),
        authorName:
          target.get<{ name: string }>(
            "SELECT name FROM users WHERE id=?",
            author,
          )?.name ?? "无主内容",
        kind:
          (content as { type?: string }).type === "deleted" ? "text" : "text",
        preview: text.slice(0, 1000),
        bodyLength: text.length,
        replyTo: row.reply_to
          ? mapId(target, "posts", String(row.reply_to))
          : null,
        created: time(row.created_at),
        edited: row.edited_at ? time(row.edited_at) : null,
        deletedAt: row.deleted_at ? time(row.deleted_at) : null,
        sticker: null,
        image: null,
      };
      target.run(
        "INSERT INTO chat_posts VALUES(?,?,?,?,?,?,?,?)",
        id,
        c,
        data.seq,
        data.author,
        text,
        JSON.stringify(data),
        r,
        Number(!!row.deleted_at),
      );
      break;
    }
    case "convs_user": {
      const u = user("user_id");
      if (!hasUser(u))
        throw new AppError("E_INVALID", "orphan conversation state");
      const raw = value(row, "conv_id"),
        c = mapId(
          target,
          raw.startsWith("dm:") ? "dms" : "groups",
          raw.replace(/^(group|dm):/, ""),
        );
      if (!target.get("SELECT 1 FROM community_conversations WHERE id=?", c))
        throw new AppError("E_INVALID", "orphan conversation state");
      const last = row.last_read_post_id
        ? (target.get<{ seq: number }>(
            "SELECT seq FROM chat_posts WHERE id=?",
            mapId(target, "posts", String(row.last_read_post_id)),
          )?.seq ?? 0)
        : 0;
      const stamp = (ms: number) => ({
        t: { ms, counter: 0 },
        op: legacyUlid("operation", "legacy"),
      });
      const state = {
        id: c,
        conversation: c,
        readSeq: last,
        pin: {
          v: !!row.pinned_at,
          ...stamp(number(row, "pinned_updated_at_ms")),
        },
        mute: { v: !!row.muted, ...stamp(number(row, "muted_updated_at_ms")) },
        draft: {
          v: value(row, "compose_draft").slice(0, 16000),
          ...stamp(number(row, "compose_draft_updated_at")),
        },
        draftTextId: null,
        retention: { v: "auto", ...stamp(0) },
        lastSeq:
          target.get<{ seq: number }>(
            "SELECT max(seq) seq FROM chat_posts WHERE conversation=?",
            c,
          )?.seq ?? 0,
        lastPost: null,
        updated: time(row.updated_at),
        mutedUntil: 0,
      };
      target.run(
        "INSERT OR REPLACE INTO chat_states VALUES(?,?,?,?,0)",
        u,
        c,
        JSON.stringify(state),
        r,
      );
      break;
    }
    case "post_images":
      break;
    case "post_image_thumbs":
      // The target thumbnail is regenerated from the original image.
      break;
  }
  return id;
}
