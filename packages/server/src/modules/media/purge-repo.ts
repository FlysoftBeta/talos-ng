import type { Db } from "../../kernel/persistence/db.ts";
import type { WriteContext } from "../../kernel/persistence/uow.ts";
import type { PurgePorts } from "./purge.ts";
export class MediaPurgeRepo {
  constructor(private readonly db: Db) {}
  purgeUser(user: string, ctx: WriteContext, domains: PurgePorts): void {
    const db = this.db;
    for (const row of db.all<{ id: string; deleted: number }>(
      "SELECT id,deleted FROM media_playlists WHERE owner=?",
      user,
    )) {
      domains.revokeResource(`coll:${row.id}`, ctx);
      if (!row.deleted) domains.deletePlaylist(row.id);
    }

    db.run(
      "DELETE FROM media_playlist_tracks WHERE playlist IN (SELECT id FROM media_playlists WHERE owner=?)",
      user,
    );
    db.run("DELETE FROM media_discoveries WHERE user_id=?", user);
    db.run("DELETE FROM media_playlists WHERE owner=?", user);
    db.run("DELETE FROM media_user_states WHERE user_id=?", user);
  }
}
