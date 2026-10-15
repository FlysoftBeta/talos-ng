import { ImportObjectBatch } from "./object-batch.ts";
import { sourceRows } from "../legacy/readers.ts";
import { createReadStream } from "node:fs";
import type { Db, createKernel } from "@talos/server/migration";
import { AppError } from "@talos/base";
import type { Options, LegacyRow } from "../types.ts";
import { exists, type LegacyDb } from "../legacy/db.ts";
import { value, number } from "../values.ts";
import { issue, sourceId, mapId } from "../journal.ts";
import { legacyBlobPath } from "../legacy/blobs.ts";
export async function materializeMedia(
  source: LegacyDb,
  target: Db,
  kernel: ReturnType<typeof createKernel>,
  options: Options,
): Promise<void> {
  const batch = new ImportObjectBatch(kernel);
  if (exists(source, "media_assets"))
    for (let offset = 0; ; offset += 500) {
      const rows = sourceRows(source, "media_assets", offset);
      if (!rows.length) break;
      for (const row of rows) {
        const legacyId = sourceId(row),
          blob = value(row, "blob_id"),
          id = mapId(target, "media_tracks", value(row, "track_id"));
        if (
          target.get(
            "SELECT 1 FROM migration_media_objects WHERE legacy_id=?",
            legacyId,
          )
        )
          continue;
        if (value(row, "state") !== "ready" || !blob) {
          issue(
            target,
            "media_assets",
            legacyId,
            "Unmaterialized/failed asset has no downloaded bytes; target can prepare audio again",
          );
          continue;
        }
        const failed = (error: unknown): void => {
          issue(
            target,
            "media_assets",
            legacyId,
            `audio/cover import: ${error instanceof Error ? error.message : String(error)}`,
          );
        };
        try {
          const path = legacyBlobPath(options.blobs, blob);
          await batch.publish(
            (put) =>
              put(createReadStream(path), {
                ...(row.sha256 ? { id: value(row, "sha256") } : {}),
                size: number(row, "bytes"),
              }),
            (info) => {
              if (value(row, "kind") === "audio")
                kernel.media.importTrack({
                  ...kernel.media.track(id),
                  audio: {
                    id: info.id,
                    size: info.size,
                    mime: value(row, "mime") || "audio/mpeg",
                  },
                });
              else {
                kernel.objects.addRef(info.id, "media.cover", id);
                issue(
                  target,
                  "media_assets",
                  legacyId,
                  "Cover preserved in ledger; target track has no cover field",
                );
              }
              target.run(
                "INSERT INTO migration_media_objects VALUES(?,?)",
                legacyId,
                info.id,
              );
            },
            failed,
          );
        } catch (error) {
          failed(error);
        }
      }
      await batch.flush();
    }
  if (exists(source, "media_lists"))
    for (let offset = 0; ; offset += 500) {
      const rows = sourceRows(source, "media_lists", offset);
      if (!rows.length) break;
      for (const row of rows) {
        if (value(row, "kind") === "queue") continue;
        const legacyId = value(row, "id"),
          id = mapId(target, "media_lists", legacyId);
        try {
          if (
            source.get<{ n: number }>(
              "SELECT count(*) n FROM media_list_items WHERE list_id=?",
              legacyId,
            )!.n > 500
          )
            throw new AppError(
              "E_INVALID",
              "Playlist exceeds target 500-track limit; source preserved in backup",
            );
          const items = source.all<LegacyRow>(
            "SELECT * FROM media_list_items WHERE list_id=? ORDER BY position LIMIT 500",
            legacyId,
          );
          if (items.length > 500)
            throw new AppError(
              "E_INVALID",
              "Playlist exceeds target 500-track limit; source preserved in backup",
            );
          const tracks = items.map((x) =>
            mapId(target, "media_tracks", value(x, "track_id")),
          );
          for (const track of tracks) kernel.media.track(track);
          kernel.media.importPlaylist({ ...kernel.media.playlist(id), tracks });
        } catch (error) {
          issue(
            target,
            "media_lists",
            legacyId,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }
}
