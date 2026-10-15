import type { Db, createKernel } from "@talos/server/migration";
import { AppError } from "@talos/base";
import type { LegacyRow } from "../types.ts";
import type { LegacyDb } from "../legacy/db.ts";
import { owner } from "../legacy/access.ts";
import { value, number, time, json } from "../values.ts";
import { mapId } from "../journal.ts";
export function importMedia(
  target: Db,
  table: string,
  row: LegacyRow,
  legacyId: string,
  kernel: ReturnType<typeof createKernel>,
  source: LegacyDb,
): string {
  const id = mapId(target, table, legacyId),
    media = kernel.media;
  switch (table) {
    case "media_tracks":
      media.importTrack(
        {
          id,
          source: value(row, "source"),
          providerId: value(row, "provider_id"),
          title: value(row, "title").slice(0, 200) || "Untitled",
          artists: (json(row.artists_json, []) as string[]).slice(0, 20),
          album: row.album == null ? null : value(row, "album"),
          durationMs: number(row, "duration_ms"),
          audio: null,
        },
        time(row.last_used_at),
      );
      break;
    case "media_lists": {
      if (value(row, "kind") === "queue") break;
      const created = time(row.created_at),
        days = number(row, "retention_days", 7),
        expiry = time(row.expires_at);
      media.importPlaylist({
        id,
        owner: owner(source, target, "playlist", legacyId),
        title: value(row, "title").slice(0, 80) || "Untitled",
        tracks: [],
        retentionDays: days,
        created,
        lastPlayed: expiry ? Math.max(0, expiry - days * 86400000) : 0,
      });
      break;
    }
    case "media_list_items":
      break; // Membership is assembled in legacy position order after all rows are journaled.
    case "media_assets":
      break; // Streams are published after metadata.
    case "user_queues": {
      const u = mapId(target, "users", value(row, "user_id"));
      if (!target.get("SELECT 1 FROM users WHERE id=?", u))
        throw new AppError("E_INVALID", "Orphan media queue");
      if (
        source.get<{ n: number }>(
          "SELECT count(*) n FROM media_list_items WHERE list_id=?",
          value(row, "list_id"),
        )!.n > 500
      )
        throw new AppError("E_INVALID", "Queue exceeds target 500-track limit");
      const tracks = source.all<LegacyRow>(
        "SELECT * FROM media_list_items WHERE list_id=? ORDER BY position LIMIT 500",
        value(row, "list_id"),
      );
      if (tracks.length > 500)
        throw new AppError("E_INVALID", "Queue exceeds target 500-track limit");
      media.importState(u, {
        ...media.state(u),
        queue: tracks.map((x) =>
          mapId(target, "media_tracks", value(x, "track_id")),
        ),
        queueStamp: { t: { ms: 0, counter: 0 }, op: id },
      });
      break;
    }
    case "media_favorite": {
      const u = mapId(target, "users", value(row, "user_id"));
      const track = mapId(target, "media_tracks", value(row, "resource_id"));
      media.track(track);
      media.importState(u, {
        ...media.state(u),
        favorites: {
          ...media.state(u).favorites,
          [track]: {
            v: !!row.favorited,
            t: { ms: number(row, "updated_at_ms"), counter: 0 },
            op: id,
          },
        },
      });
      break;
    }
  }
  return id;
}
