import type { Migration } from "../../kernel/persistence/db.ts";
export const mediaMigrations: readonly Migration[] = [
  {
    n: 1,
    up(db) {
      db.exec(`CREATE TABLE media_tracks(id TEXT PRIMARY KEY,source TEXT NOT NULL,provider_id TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),object_id TEXT,last_played INTEGER NOT NULL DEFAULT 0,rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)),UNIQUE(source,provider_id)) STRICT;
CREATE INDEX media_tracks_last_played ON media_tracks(last_played);
CREATE TABLE media_playlists(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL CHECK(json_valid(body)),rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1))) STRICT;
CREATE INDEX media_playlists_owner_rev ON media_playlists(owner,rev);
CREATE TABLE media_user_states(user_id TEXT PRIMARY KEY REFERENCES users(id),body TEXT NOT NULL CHECK(json_valid(body)),rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1))) STRICT;`);
    },
  },
  {
    n: 2,
    up(db) {
      db.exec(
        "CREATE TABLE media_delegations(playlist TEXT NOT NULL,principal_type TEXT NOT NULL,principal TEXT NOT NULL,delegable INTEGER NOT NULL CHECK(delegable IN(0,1)),PRIMARY KEY(playlist,principal_type,principal)) STRICT;",
      );
    },
  },
  {
    n: 3,
    up(db) {
      db.exec(`
CREATE TABLE media_discoveries(user_id TEXT NOT NULL REFERENCES users(id),track TEXT NOT NULL REFERENCES media_tracks(id),rev INTEGER NOT NULL,PRIMARY KEY(user_id,track)) STRICT;
CREATE TABLE media_playlist_tracks(playlist TEXT NOT NULL,track TEXT NOT NULL,rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(playlist,track)) STRICT;
INSERT INTO media_playlist_tracks SELECT p.id,j.value,p.rev,0 FROM media_playlists p,json_each(p.body,'$.tracks') j WHERE p.deleted=0;
`);
    },
  },
];
