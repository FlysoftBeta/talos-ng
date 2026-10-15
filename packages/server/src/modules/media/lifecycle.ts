import type { MediaTrack, MediaUserState } from "@talos/contract";
import type { ObjectLedger } from "../../kernel/objects/objects.ts";
import type { WriteContext } from "../../kernel/persistence/uow.ts";
import type { MediaRepo, MediaRow } from "./repo.ts";

/** Membership is the only retention reference. Search/play/favourite never restart this clock. */
export function reconcileTracks(
  repo: MediaRepo,
  ids: readonly string[],
  ctx: WriteContext,
  now: number,
): void {
  for (const id of new Set(ids)) {
    repo.db.run(
      `UPDATE media_tracks SET unreferenced_since=CASE
      WHEN EXISTS(SELECT 1 FROM media_playlist_tracks WHERE track=? AND deleted=0) THEN NULL
      ELSE COALESCE(unreferenced_since,?) END WHERE id=? AND deleted=0`,
      id,
      now,
      id,
    );
  }
  // Publish state again when membership changes: a reader may have lost access,
  // even if someone else's playlist (or their own discovery) still retains access.
  updateStates(repo, ids, new Set(), ctx);
}

/** Existing scheduled eviction calls this in the same writer transaction as audio eviction. */
export function reclaimTracks(
  repo: MediaRepo,
  objects: ObjectLedger,
  cutoff: number,
  ctx: WriteContext,
): number {
  const expired = repo.db.all<MediaRow>(
    `SELECT * FROM media_tracks t
    WHERE t.deleted=0 AND t.unreferenced_since<=?
    AND NOT EXISTS(SELECT 1 FROM media_playlist_tracks p WHERE p.track=t.id AND p.deleted=0)
    ORDER BY t.unreferenced_since,t.id LIMIT 100`,
    cutoff,
  );
  for (const row of expired) {
    const track = JSON.parse(row.body) as MediaTrack;
    objects.removeOwnerRefs("media.audio", row.id);
    objects.removeOwnerRefs("media.cover", row.id);
    repo.db.run(
      "UPDATE media_tracks SET deleted=1,object_id=NULL,body=?,rev=? WHERE id=?",
      JSON.stringify({ ...track, audio: null }),
      ctx.rev,
      row.id,
    );
    repo.db.run(
      "UPDATE media_discoveries SET deleted=1,rev=? WHERE track=?",
      ctx.rev,
      row.id,
    );
    for (const user of repo.discoverers(row.id))
      ctx.changed(`me:${user.user_id}`, "mediaTrack", row.id);
  }
  const ids = expired.map((r) => r.id);
  updateStates(repo, ids, new Set(ids), ctx);
  return expired.length;
}

function updateStates(
  repo: MediaRepo,
  ids: readonly string[],
  removed: ReadonlySet<string>,
  ctx: WriteContext,
): void {
  if (!ids.length) return;
  for (const row of repo.db.all<MediaRow>(
    "SELECT user_id AS id,body,rev,deleted FROM media_user_states",
  )) {
    const state = JSON.parse(row.body) as MediaUserState;
    if (
      !ids.some(
        (id) =>
          state.queue.includes(id) ||
          state.recents.includes(id) ||
          id in state.favorites,
      )
    )
      continue;
    repo.putState(
      row.id,
      {
        ...state,
        queue: state.queue.filter((id) => !removed.has(id)),
        recents: state.recents.filter((id) => !removed.has(id)),
        favorites: Object.fromEntries(
          Object.entries(state.favorites).filter(([id]) => !removed.has(id)),
        ),
      },
      ctx.rev,
    );
    ctx.changed(`me:${row.id}`, "mediaUserState", row.id);
  }
}
