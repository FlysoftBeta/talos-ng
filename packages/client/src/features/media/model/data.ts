import {
  mediaRetentionEntitySchema,
  mediaTrackSchema,
  mediaPlaylistSchema,
  mediaUserStateSchema,
} from "@talos/contract";
import type {
  MediaRetention,
  MediaTrack,
  MediaPlaylist,
  MediaUserState,
} from "@talos/contract";
import type { StoredRow } from "../../../core/data/db.ts";
export interface MediaData {
  retentions: Map<string, MediaRetention>;
  tracks: MediaTrack[];
  playlists: MediaPlaylist[];
  state: MediaUserState | null;
  rows: readonly StoredRow[];
}
export function decodeMedia(
  rows: readonly StoredRow[],
  user?: string,
): MediaData {
  const tracks = new Map<string, MediaTrack>(),
    playlists = new Map<string, MediaPlaylist>();
  let state: MediaUserState | null = null;
  const retentions = new Map<string, MediaRetention>();
  const admitted = new Map(
    rows
      .filter((row) => !row.deleted && row.type === "mediaPlaylist")
      .map((row) => [row.scope, mediaPlaylistSchema.safeParse(row.data)]),
  );
  for (const row of rows.slice().sort((a, b) => a.rev - b.rev)) {
    if (row.deleted) continue;
    if (
      row.type === "mediaRetention" &&
      row.scope.startsWith("me:") &&
      (!user || row.scope === `me:${user}`)
    ) {
      const value = mediaRetentionEntitySchema.safeParse(row.data);
      if (value.success) retentions.set(row.id, value.data);
    }
    if (row.type === "mediaTrack") {
      if (row.scope.startsWith("coll:")) {
        const playlist = admitted.get(row.scope);
        if (!playlist?.success || !playlist.data.tracks.includes(row.id))
          continue;
      }
      const p = mediaTrackSchema.safeParse(row.data);
      if (p.success) tracks.set(row.id, p.data);
    }
    if (row.type === "mediaPlaylist") {
      const p = mediaPlaylistSchema.safeParse(row.data);
      if (p.success) playlists.set(row.id, p.data);
    }
    if (row.type === "mediaUserState") {
      const p = mediaUserStateSchema.safeParse(row.data);
      if (p.success) state = p.data;
    }
  }
  return {
    retentions,
    tracks: [...tracks.values()],
    playlists: [...playlists.values()],
    state: state
      ? {
          ...state,
          queue: state.queue.filter((id) => tracks.has(id)),
          recents: state.recents.filter((id) => tracks.has(id)),
          favorites: Object.keys(state.favorites).reduce<
            MediaUserState["favorites"]
          >((out, id) => {
            if (tracks.has(id)) out[id] = state!.favorites[id]!;
            return out;
          }, {}),
        }
      : null,
    rows,
  };
}

/** Owner, or holder of a write/own grant on the playlist's resource. */
export function canEditPlaylist(
  data: Pick<MediaData, "rows">,
  playlist: MediaPlaylist,
  user: string | undefined,
): boolean {
  return (
    playlist.owner === user ||
    data.rows.some((r) => {
      const grant = r.data as { resource?: string; level?: string };
      return (
        r.type === "grant" &&
        grant.resource === `coll:${playlist.id}` &&
        ["write", "own"].includes(grant.level ?? "")
      );
    })
  );
}
