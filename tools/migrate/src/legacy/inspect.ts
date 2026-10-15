import { existsSync } from "node:fs";
import type { Options } from "../types.ts";
import { exists, type LegacyDb } from "./db.ts";
import { tables, sourceRows } from "./readers.ts";
import { value, json } from "../values.ts";
import { legacyBlobPath } from "./blobs.ts";
export function inspect(source: LegacyDb): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of tables)
    if (exists(source, table))
      counts[table] = source.get<{ n: number }>(
        `SELECT count(*) n FROM "${table}"`,
      )!.n;
  return counts;
}
export function anomalies(
  source: LegacyDb,
  options: Options,
): Record<string, number> {
  const result = {
    duplicateHandles: 0,
    orphanRows: 0,
    missingBlobs: 0,
    replacementChars: 0,
    oversizedText: 0,
  };
  if (exists(source, "users"))
    result.duplicateHandles =
      source.get<{ n: number }>(
        "SELECT count(*) n FROM (SELECT lower(handle) FROM users GROUP BY lower(handle) HAVING count(*)>1)",
      )?.n ?? 0;
  const checks: Array<[string, string]> = [
    [
      "group_members",
      "SELECT count(*) n FROM group_members m LEFT JOIN users u ON m.user_id=u.id LEFT JOIN groups g ON m.group_id=g.id WHERE u.id IS NULL OR g.id IS NULL",
    ],
    [
      "user_pins",
      "SELECT count(*) n FROM user_pins p LEFT JOIN users u ON p.user_id=u.id WHERE u.id IS NULL",
    ],
    [
      "posts",
      "SELECT count(*) n FROM posts p LEFT JOIN users u ON p.author_id=u.id WHERE p.author_id IS NOT NULL AND u.id IS NULL",
    ],
    [
      "text_article_segments",
      "SELECT count(*) n FROM text_article_segments s LEFT JOIN articles a ON s.article_id=a.id WHERE a.id IS NULL",
    ],
    [
      "ai_messages",
      "SELECT count(*) n FROM ai_messages m LEFT JOIN ai_conversations c ON m.conversation_id=c.id WHERE c.id IS NULL",
    ],
  ];
  for (const [table, sql] of checks)
    if (exists(source, table))
      result.orphanRows += source.get<{ n: number }>(sql)?.n ?? 0;
  for (const table of ["users", "posts", "articles", "ai_messages"])
    if (exists(source, table))
      for (let offset = 0; ; offset += 500) {
        const rows = sourceRows(source, table, offset);
        if (!rows.length) break;
        for (const row of rows) {
          if (
            Object.values(row).some(
              (v) => typeof v === "string" && v.includes("�"),
            )
          )
            result.replacementChars++;
          if (table === "posts" && value(row, "brief").length > 16_000)
            result.oversizedText++;
          if (table === "articles") {
            const provider = json(row.provider_json, {}) as {
              source_file?: string;
            };
            if (provider.source_file) {
              try {
                if (
                  !existsSync(
                    legacyBlobPath(options.blobs, provider.source_file),
                  )
                )
                  result.missingBlobs++;
              } catch {
                result.missingBlobs++;
              }
            }
          }
        }
      }
  for (const table of ["post_images", "media_assets", "ai_workspaces"])
    if (exists(source, table))
      for (let offset = 0; ; offset += 500) {
        const rows = sourceRows(source, table, offset);
        if (!rows.length) break;
        for (const row of rows) {
          const blob = value(row, "blob_id");
          if (blob) {
            try {
              if (!existsSync(legacyBlobPath(options.blobs, blob)))
                result.missingBlobs++;
            } catch {
              result.missingBlobs++;
            }
          }
        }
      }
  return result;
}
