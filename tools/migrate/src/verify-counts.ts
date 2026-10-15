import { sourceRows } from "./legacy/readers.ts";
import type { Db } from "@talos/server/migration";
import { exists, type LegacyDb } from "./legacy/db.ts";
import type { LegacyRow } from "./types.ts";
import { value, json } from "./values.ts";
import { mapId } from "./journal.ts";
function present(
  source: LegacyDb,
  target: Db,
  table: string,
  row: LegacyRow,
): boolean | undefined {
  const id = mapId(target, table, value(row, "id")),
    user = mapId(target, "users", value(row, "user_id"));
  const has = (sql: string, ...params: (string | number)[]): boolean =>
    !!target.get(sql, ...params);
  const one: Record<string, string> = {
    users: "users",
    posts: "chat_posts",
    articles: "library_documents",
    words: "learning_words",
    clients: "devices",
    ghost_users: "invitations",
  };
  if (one[table]) return has(`SELECT 1 FROM ${one[table]} WHERE id=?`, id);
  switch (table) {
    case "user_pins":
      return has("SELECT 1 FROM user_pins WHERE user_id=?", user); // Transparent login rehash changes hash.
    case "user_admin_roles":
      return has(
        "SELECT 1 FROM users,json_each(users.roles) role WHERE users.id=? AND role.value=?",
        user,
        value(row, "role"),
      );
    case "deleted_users":
      return has(
        "SELECT 1 FROM users WHERE id=? AND deleted=1",
        mapId(target, "users", value(row, "id")),
      );
    case "groups":
      return has("SELECT 1 FROM community_conversations WHERE id=?", id);
    case "dms":
      return has("SELECT 1 FROM community_conversations WHERE id=?", id);
    case "group_members":
      return has(
        "SELECT 1 FROM community_members WHERE conversation=? AND user=?",
        mapId(target, "groups", value(row, "group_id")),
        user,
      );
    case "convs_user": {
      const conv = value(row, "conv_id");
      return has(
        "SELECT 1 FROM chat_states WHERE conversation=? AND user=?",
        mapId(
          target,
          conv.startsWith("dm:") ? "dms" : "groups",
          conv.replace(/^(group|dm):/, ""),
        ),
        user,
      );
    }
    case "text_article_segments":
      return has(
        "SELECT 1 FROM migration_text_segments WHERE article_id=? AND segment_index=?",
        mapId(target, "articles", value(row, "article_id")),
        Number(row.segment_index),
      );
    case "booklists":
      return has("SELECT 1 FROM library_collections WHERE id=?", id);
    case "booklist_items":
      return has(
        "SELECT 1 FROM library_items WHERE collection=? AND id=? AND deleted=0",
        mapId(target, "booklists", value(row, "booklist_id")),
        mapId(target, "articles", value(row, "article_id")),
      );
    case "group_booklists":
      return has(
        "SELECT 1 FROM library_collections WHERE id=? AND json_extract(body,'$.group')=?",
        mapId(target, "booklists", value(row, "booklist_id")),
        mapId(target, "groups", value(row, "group_id")),
      );
    case "access_bindings": {
      const kind = value(row, "resource_kind");
      if (!["playlist", "booklist", "collection"].includes(kind))
        return undefined;
      return has(
        "SELECT 1 FROM authority_grants WHERE resource=? AND principal_type=? AND principal=? AND deleted=0",
        `coll:${mapId(target, kind === "playlist" ? "media_lists" : "booklists", value(row, "resource_id"))}`,
        value(row, "principal_kind"),
        mapId(
          target,
          value(row, "principal_kind") === "user" ? "users" : "groups",
          value(row, "principal_id"),
        ),
      );
    }
    case "article_read_progress":
      return has(
        "SELECT 1 FROM library_states WHERE user_id=? AND id=?",
        user,
        mapId(target, "articles", value(row, "article_id")),
      );
    case "user_favorites": {
      const kind = value(row, "resource_kind");
      if (kind === "article")
        return has(
          "SELECT 1 FROM library_states WHERE user_id=? AND id=?",
          user,
          mapId(target, "articles", value(row, "resource_id")),
        );
      if (["track", "media_track"].includes(kind)) {
        const state = target.get<{ body: string }>(
          "SELECT body FROM media_user_states WHERE user_id=?",
          user,
        );
        return (
          !!state &&
          (json(state.body, {}) as { favorites: Record<string, unknown> })
            .favorites[
            mapId(target, "media_tracks", value(row, "resource_id"))
          ] !== undefined
        );
      }
      return undefined;
    }
    case "user_word_progress":
      return has(
        "SELECT 1 FROM learning_progress WHERE user_id=? AND word_id=?",
        user,
        mapId(target, "words", value(row, "word_id")),
      );
    case "ai_conversations":
      return has(
        "SELECT 1 FROM ai_rows WHERE type='aiConversation' AND id=?",
        id,
      );
    case "ai_messages":
      return has("SELECT 1 FROM ai_messages WHERE id=?", id);
    case "ai_credit_accounts":
    case "ai_plan_enrollments":
      return has("SELECT 1 FROM ai_accounts WHERE user=?", user);
    case "ai_credit_ledger":
      return has("SELECT 1 FROM ai_ledger WHERE id=?", id);
    case "ai_credit_reservations":
      return value(row, "status") === "active"
        ? has(
            "SELECT 1 FROM ai_ledger WHERE fingerprint=? AND amount=0",
            `migration-reservation:${sourceReservationId(row)}`,
          )
        : undefined;
    case "ai_workspaces":
      return row.blob_id
        ? has(
            "SELECT 1 FROM migration_workspace_rows WHERE user_id=? AND object_id IS NOT NULL",
            user,
          )
        : undefined;
    case "media_tracks":
      return has("SELECT 1 FROM media_tracks WHERE id=?", id);
    case "media_assets":
      return row.blob_id && value(row, "state") === "ready"
        ? has(
            "SELECT 1 FROM migration_media_objects WHERE legacy_id=?",
            sourceReservationId(row),
          )
        : undefined;
    case "media_lists":
      return value(row, "kind") === "queue"
        ? undefined
        : has("SELECT 1 FROM media_playlists WHERE id=?", id);
    case "media_list_items": {
      const playlist = target.get<{ body: string }>(
        "SELECT body FROM media_playlists WHERE id=?",
        mapId(target, "media_lists", value(row, "list_id")),
      );
      if (playlist)
        return (
          (json(playlist.body, {}) as { tracks: string[] }).tracks[
            Number(row.position)
          ] === mapId(target, "media_tracks", value(row, "track_id"))
        );
      if (exists(source, "user_queues")) {
        const queue = source.get<{ user_id: string }>(
          "SELECT user_id FROM user_queues WHERE list_id=?",
          value(row, "list_id"),
        );
        if (queue) {
          const saved = target.get<{ body: string }>(
            "SELECT body FROM media_user_states WHERE user_id=?",
            mapId(target, "users", queue.user_id),
          );
          return (
            !!saved &&
            (json(saved.body, {}) as { queue: string[] }).queue[
              Number(row.position)
            ] === mapId(target, "media_tracks", value(row, "track_id"))
          );
        }
      }
      return false;
    }
    case "user_queues":
      return has("SELECT 1 FROM media_user_states WHERE user_id=?", user);
    case "post_images":
      return row.post_id
        ? has(
            "SELECT 1 FROM migration_images WHERE legacy_id=?",
            value(row, "id"),
          )
        : undefined;
    case "post_image_thumbs":
      return undefined; // Regenerated; source state is not imported.
    case "resource_possession":
      return undefined; // D-076 deliberately removes bearer authority.
  }
  return undefined;
}
import { sourceId as sourceReservationId } from "./journal.ts";
export function verifyCounts(
  source: LegacyDb,
  target: Db,
  tables: string[],
): {
  counts: Record<
    string,
    { expected: number; actual: number; excluded: number }
  >;
  mismatches: string[];
} {
  const counts: Record<
      string,
      { expected: number; actual: number; excluded: number }
    > = {},
    mismatches: string[] = [];
  for (const table of tables) {
    const count = { expected: 0, actual: 0, excluded: 0 };
    counts[table] = count;
    for (let offset = 0; ; offset += 500) {
      const rows = sourceRows(source, table, offset);
      if (!rows.length) break;
      for (const row of rows) {
        const result = present(source, target, table, row);
        if (result === undefined) count.excluded++;
        else {
          count.expected++;
          if (result) count.actual++;
        }
      }
    }
    const oneToOne: Record<string, string> = {
      users: "users",
      user_pins: "user_pins",
      clients: "devices",
      ghost_users: "invitations",
      posts: "chat_posts",
      articles: "library_documents",
      booklists: "library_collections",
      words: "learning_words",
      user_word_progress: "learning_progress",
      ai_messages: "ai_messages",
      media_tracks: "media_tracks",
      media_lists: "media_playlists",
      media_assets: "migration_media_objects",
      post_images: "migration_images",
    };
    if (oneToOne[table]) {
      const actual = target.get<{ n: number }>(
        `SELECT count(*) n FROM ${oneToOne[table]}`,
      )!.n;
      if (actual !== count.expected)
        mismatches.push(
          `${table}: total target count ${actual}/${count.expected}`,
        );
    }
    if (count.actual !== count.expected)
      mismatches.push(
        `${table}: target entities ${count.actual}/${count.expected}`,
      );
  }
  return { counts, mismatches };
}
