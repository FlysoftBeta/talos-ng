import type {
  MediaTrack,
  MediaPlaylist,
  MediaUserState,
} from "@talos/contract";
import type { Row } from "@talos/sync";
import type { Db } from "../../kernel/persistence/db.ts";
export interface MediaRow {
  id: string;
  body: string;
  rev: number;
  deleted: number;
  owner?: string;
  object_id?: string;
  last_played?: number;
}
export class MediaRepo {
  discoverers(track: string): { user_id: string }[] {
    return this.db.all(
      "SELECT user_id FROM media_discoveries WHERE track=?",
      track,
    );
  }
  discover(user: string, track: string, rev: number): void {
    this.db.run(
      "INSERT INTO media_discoveries VALUES(?,?,?) ON CONFLICT(user_id,track) DO UPDATE SET rev=excluded.rev",
      user,
      track,
      rev,
    );
  }

  constructor(readonly db: Db) {}
  track(id: string): MediaRow | undefined {
    return this.db.get("SELECT * FROM media_tracks WHERE id=?", id);
  }
  source(source: string, providerId: string): MediaRow | undefined {
    return this.db.get(
      "SELECT * FROM media_tracks WHERE source=? AND provider_id=?",
      source,
      providerId,
    );
  }
  tracks(): MediaRow[] {
    return this.db.all(
      "SELECT * FROM media_tracks WHERE deleted=0 ORDER BY last_played DESC,id",
    );
  }
  playlist(id: string): MediaRow | undefined {
    return this.db.get("SELECT * FROM media_playlists WHERE id=?", id);
  }
  playlists(): MediaRow[] {
    return this.db.all(
      "SELECT * FROM media_playlists WHERE deleted=0 ORDER BY rev DESC,id",
    );
  }
  state(user: string): MediaRow | undefined {
    return this.db.get(
      "SELECT user_id AS id,body,rev,deleted FROM media_user_states WHERE user_id=?",
      user,
    );
  }
  putTrack(value: MediaTrack, rev: number, lastPlayed = 0): void {
    this.db.run(
      "INSERT INTO media_tracks(id,source,provider_id,body,object_id,last_played,rev) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,object_id=excluded.object_id,last_played=excluded.last_played,rev=excluded.rev",
      value.id,
      value.source,
      value.providerId,
      JSON.stringify(value),
      value.audio?.id ?? null,
      lastPlayed,
      rev,
    );
  }
  putPlaylist(value: MediaPlaylist, rev: number, deleted = false): void {
    this.db.run(
      "UPDATE media_playlist_tracks SET deleted=1,rev=? WHERE playlist=?",
      rev,
      value.id,
    );
    if (!deleted)
      for (const track of value.tracks)
        this.db.run(
          "INSERT INTO media_playlist_tracks VALUES(?,?,?,0) ON CONFLICT(playlist,track) DO UPDATE SET rev=excluded.rev,deleted=0",
          value.id,
          track,
          rev,
        );
    this.db.run(
      "INSERT INTO media_playlists VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,rev=excluded.rev,deleted=excluded.deleted",
      value.id,
      value.owner,
      JSON.stringify(value),
      rev,
      +deleted,
    );
  }
  putState(user: string, value: MediaUserState, rev: number): void {
    this.db.run(
      "INSERT INTO media_user_states VALUES(?,?,?,0) ON CONFLICT(user_id) DO UPDATE SET body=excluded.body,rev=excluded.rev",
      user,
      JSON.stringify(value),
      rev,
    );
  }
  delegation(playlist: string, type: string, principal: string): boolean {
    return !!this.db.get<{ delegable: number }>(
      "SELECT delegable FROM media_delegations WHERE playlist=? AND principal_type=? AND principal=?",
      playlist,
      type,
      principal,
    )?.delegable;
  }
  delegate(
    playlist: string,
    type: string,
    principal: string,
    value: boolean,
  ): void {
    this.db.run(
      "INSERT INTO media_delegations VALUES(?,?,?,?) ON CONFLICT(playlist,principal_type,principal) DO UPDATE SET delegable=excluded.delegable",
      playlist,
      type,
      principal,
      +value,
    );
  }
  row(type: string, value: MediaRow): Row {
    return {
      type,
      id: value.id,
      rev: value.rev,
      deleted: !!value.deleted,
      data: value.deleted ? null : (JSON.parse(value.body) as unknown),
    };
  }
}
