import type { Migration } from "../../kernel/persistence/db.ts";
export const mediaMigrations: readonly Migration[] = [
  {
    n: 1,
    up(db) {
      db.exec(`CREATE TABLE media_retentions(user_id TEXT NOT NULL REFERENCES users(id),id TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),rev INTEGER NOT NULL,PRIMARY KEY(user_id,id)) STRICT;
CREATE INDEX media_retentions_rev ON media_retentions(user_id,rev);
CREATE TABLE media_tracks(id TEXT PRIMARY KEY,source TEXT NOT NULL,provider_id TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),object_id TEXT,last_played INTEGER NOT NULL DEFAULT 0,unreferenced_since INTEGER,generation INTEGER NOT NULL DEFAULT 0,rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)),UNIQUE(source,provider_id)) STRICT;
CREATE INDEX media_tracks_last_played ON media_tracks(last_played);
CREATE INDEX media_tracks_unreferenced ON media_tracks(unreferenced_since) WHERE deleted=0;
CREATE TABLE media_playlists(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL CHECK(json_valid(body)),rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1))) STRICT;
CREATE INDEX media_playlists_owner_rev ON media_playlists(owner,rev);
CREATE TABLE media_user_states(user_id TEXT PRIMARY KEY REFERENCES users(id),body TEXT NOT NULL CHECK(json_valid(body)),rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1))) STRICT;`);
    },
  },
  {
    n: 2,
    up(db) {
      db.exec(`CREATE TABLE media_playlist_tracks(playlist TEXT NOT NULL,track TEXT NOT NULL,rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(playlist,track)) STRICT;
CREATE INDEX media_playlist_tracks_track ON media_playlist_tracks(track,deleted);
CREATE TABLE media_discoveries(user_id TEXT NOT NULL REFERENCES users(id),track TEXT NOT NULL REFERENCES media_tracks(id),rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,track)) STRICT;`);
    },
  },
];
