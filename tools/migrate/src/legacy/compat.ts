import type { DatabaseSync } from "node:sqlite";
import { AppError } from "@talos/base";

/** Connection-local views adapt v25/v26 without running the destructive legacy upgrade. */
export function installCompatibility(db: DatabaseSync): void {
  const has = (table: string): boolean =>
    !!db
      .prepare("SELECT 1 FROM sqlite_master WHERE name=? AND type='table'")
      .get(table);
  if (!has("config")) return;
  const version = db
    .prepare("SELECT value FROM config WHERE key='schema_version'")
    .get()?.value;
  if (version == null) return; // Historical synthetic fixtures have no version ledger.
  if (!["25", "26", "27", "28"].includes(String(version)))
    throw new AppError("E_INVALID", "Supported legacy schema versions: 25–28");
  if (Number(version) >= 27) return;
  // v25's path-based binary store has different semantics. Never silently discard it
  // as the old application's v25→v26 upgrade does.
  if (
    Number(version) === 25 &&
    ((has("media_assets") &&
      db.prepare("SELECT 1 FROM media_assets LIMIT 1").get()) ||
      (has("articles") &&
        db
          .prepare(
            "SELECT 1 FROM articles WHERE json_extract(provider_json,'$.type') != 'text' LIMIT 1",
          )
          .get()))
  )
    throw new AppError(
      "E_INVALID",
      "v25 path-based binary assets require separate recovery; source was not modified",
    );
  if (has("article_bookmarks") && !has("user_favorites"))
    db.exec(`
    CREATE TEMP VIEW user_favorites AS SELECT rowid, user_id, 'article' resource_kind,
      article_id resource_id, bookmarked favorited, updated_at_ms, created_at FROM main.article_bookmarks;
  `);
  if (has("articles") && !has("booklists"))
    db.exec(`
    CREATE TEMP VIEW booklists AS SELECT rowid, 'legacy-group:' || id id,
      name || '的文单' title, created_at FROM main.groups
      WHERE id IN (SELECT group_id FROM main.articles WHERE group_id IS NOT NULL);
    CREATE TEMP VIEW group_booklists AS SELECT rowid, id group_id,
      'legacy-group:' || id booklist_id FROM main.groups
      WHERE id IN (SELECT group_id FROM main.articles WHERE group_id IS NOT NULL);
    CREATE TEMP VIEW booklist_items AS SELECT rowid, 'legacy-group:' || group_id booklist_id,
      row_number() OVER (PARTITION BY group_id ORDER BY created_at,id)-1 position,
      id article_id, created_at added_at FROM main.articles WHERE group_id IS NOT NULL;
  `);
  if (has("media_lists") && !has("user_queues"))
    db.exec(`
    CREATE TEMP VIEW user_queues AS SELECT rowid, owner_user_id user_id, id list_id
      FROM main.media_lists WHERE kind='queue';
  `);
  if (!has("access_bindings")) {
    const parts: string[] = [];
    if (has("articles"))
      parts.push(`SELECT rowid, 'booklist' resource_kind,
      booklist_id resource_id, 'group' principal_kind, group_id principal_id,
      '[{"mode":"owner"}]' grants_json FROM group_booklists`);
    if (has("media_lists"))
      parts.push(`SELECT rowid + coalesce((SELECT max(rowid) FROM main.groups),0) rowid,
      kind resource_kind, id resource_id, 'user' principal_kind, owner_user_id principal_id,
      '[{"mode":"owner"}]' grants_json FROM main.media_lists`);
    if (parts.length)
      db.exec(
        `CREATE TEMP VIEW access_bindings AS ${parts.join(" UNION ALL ")}`,
      );
  }
}
