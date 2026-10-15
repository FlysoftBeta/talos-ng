import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { Db } from "@talos/server/migration";
import { createFsObjectStore } from "@talos/objectstore";
import { exists, type LegacyDb } from "./legacy/db.ts";
import { legacyBlobPath } from "./legacy/blobs.ts";
import { mapId, sourceId } from "./journal.ts";
import { value, json } from "./values.ts";
import type { Options, LegacyRow } from "./types.ts";
async function hash(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest("hex");
}
function* segments(source: LegacyDb, id: string): Generator<Uint8Array> {
  for (let at = 0; ; at += 500) {
    const rows = source.all<{ content: string }>(
      "SELECT content FROM text_article_segments WHERE article_id=? ORDER BY segment_index LIMIT 500 OFFSET ?",
      id,
      at,
    );
    if (!rows.length) break;
    for (const row of rows) yield Buffer.from(row.content, "utf8");
  }
}
function* fileBytes(
  target: Db,
  user: string,
  path: string,
): Generator<Uint8Array> {
  for (let at = 1; ; at += 65536) {
    const bytes = target.get<{ bytes: Uint8Array }>(
      "SELECT substr(bytes,?,65536) bytes FROM ai_files WHERE user=? AND path=?",
      at,
      user,
      path,
    )?.bytes;
    if (!bytes?.length) break;
    yield bytes;
  }
}
export async function verifyBlobs(
  source: LegacyDb,
  target: Db,
  options: Options,
): Promise<string[]> {
  const mismatches: string[] = [],
    store = createFsObjectStore({ root: options.target });
  for (const table of [
    "articles",
    "post_images",
    "media_assets",
    "ai_workspaces",
  ]) {
    if (!exists(source, table)) continue;
    const count = source.get<{ n: number }>(
      `SELECT count(*) n FROM "${table}"`,
    )!.n;
    for (const offset of new Set([0, Math.floor(count / 2), count - 1])) {
      if (offset < 0) continue;
      const row = source.get<LegacyRow>(
        `SELECT * FROM "${table}" ORDER BY rowid LIMIT 1 OFFSET ?`,
        offset,
      );
      if (!row) continue;
      const legacyId = sourceId(row);
      try {
        let object: string | undefined, expected: string;
        if (table === "articles") {
          object = target.get<{ source: string }>(
            "SELECT source FROM library_documents WHERE id=?",
            mapId(target, table, legacyId),
          )?.source;
          const provider = json(row.provider_json, {}) as {
            type?: string;
            source_file?: string;
          };
          expected =
            provider.type === "bundle"
              ? await hash(
                  createReadStream(
                    legacyBlobPath(options.blobs, provider.source_file ?? ""),
                  ),
                )
              : await hash(
                  (async function* () {
                    yield* segments(source, legacyId);
                  })(),
                );
        } else {
          const blob = value(row, "blob_id");
          if (!blob && table === "ai_workspaces") continue;
          expected = await hash(
            createReadStream(legacyBlobPath(options.blobs, blob)),
          );
          object =
            table === "post_images"
              ? target.get<{ original_id: string }>(
                  "SELECT original_id FROM migration_images WHERE legacy_id=?",
                  legacyId,
                )?.original_id
              : table === "media_assets"
                ? target.get<{ object_id: string }>(
                    "SELECT object_id FROM migration_media_objects WHERE legacy_id=?",
                    legacyId,
                  )?.object_id
                : target.get<{ object_id: string }>(
                    "SELECT object_id FROM migration_workspace_rows WHERE legacy_id=?",
                    legacyId,
                  )?.object_id;
          if (row.sha256 && value(row, "sha256") !== expected)
            mismatches.push(`${table}/${legacyId}: legacy blob hash differs`);
          if (table === "media_assets" && value(row, "kind") === "audio") {
            const track = target.get<{ object_id: string }>(
              "SELECT object_id FROM media_tracks WHERE id=?",
              mapId(target, "media_tracks", value(row, "track_id")),
            );
            if (track?.object_id !== object)
              mismatches.push(
                `${table}/${legacyId}: track audio pointer differs`,
              );
          }
        }
        if (
          !object ||
          object !== expected ||
          (await hash(store.read(object))) !== expected ||
          !target.get("SELECT 1 FROM objects WHERE id=?", object)
        )
          mismatches.push(`${table}/${legacyId}: content blob differs/missing`);
      } catch (error) {
        mismatches.push(
          `${table}/${legacyId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  // Every workspace manifest checksum is checked; file bytes are read through bounded SQLite substrings.
  let cursor = 0;
  for (;;) {
    const rows = target.all<{
      rowid: number;
      user_id: string;
      path: string;
      sha256: string;
    }>(
      "SELECT rowid,* FROM migration_workspace_files WHERE rowid>? ORDER BY rowid LIMIT 500",
      cursor,
    );
    if (!rows.length) break;
    for (const row of rows) {
      cursor = row.rowid;
      const actual = await hash(
        (async function* () {
          yield* fileBytes(target, row.user_id, row.path);
        })(),
      );
      if (actual !== row.sha256)
        mismatches.push(
          `ai_files/${row.user_id}/${row.path}: content hash differs`,
        );
      if (!(await store.verify(row.sha256)))
        mismatches.push(
          `ai_files/${row.user_id}/${row.path}: ledger object hash differs`,
        );
    }
  }
  return mismatches;
}
