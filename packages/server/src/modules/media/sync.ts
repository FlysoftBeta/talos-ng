import type { MediaAccess } from "./access.ts";
import type { MediaRow } from "./repo.ts";
import type { Row } from "@talos/sync";
import type { SyncHub } from "../../kernel/sync/sync-hub.ts";
import type { MediaService } from "./service.ts";
import type { AuthorityService } from "../authority/index.ts";
import type { MediaPlaylist } from "@talos/contract";
export function registerMediaSync(
  hub: SyncHub,
  service: MediaService,
  authority: AuthorityService,
  access: MediaAccess,
): void {
  const repo = service.repo;
  const allowed = (user: string, p: MediaPlaylist): boolean =>
    access.playlist(user, p);
  const me = (user: string): Row[] => {
    const state = repo.state(user);
    const enabled = authority.can(user, "feature.use", { feature: "media" });
    const accessRev = authority.repo.revision(user);
    return [
      // A personal preference never grants target access. Preserve it through
      // revoke/regrant instead of synthesizing another entity's revision.
      ...repo.retentions(user).map((row) => repo.row("mediaRetention", row)),
      ...service.options.db
        .all<MediaRow>("SELECT * FROM media_playlists WHERE owner=?", user)
        .map((row) => ({
          ...repo.row("mediaPlaylist", row),
          rev: Math.max(row.rev, accessRev),
          deleted: !!row.deleted || !enabled,
          data:
            row.deleted || !enabled ? null : (JSON.parse(row.body) as unknown),
        })),
      ...service.options.db
        .all<{ track: string; rev: number; deleted: number }>(
          "SELECT track,rev,deleted FROM media_discoveries WHERE user_id=?",
          user,
        )
        .map((d) => {
          const row = repo.track(d.track)!;
          const deleted = !!d.deleted || !!row.deleted || !enabled;
          return {
            ...repo.row("mediaTrack", row),
            rev: Math.max(d.rev, row.rev, accessRev),
            deleted,
            data: deleted ? null : (JSON.parse(row.body) as unknown),
          };
        }),
      ...(state
        ? [
            {
              ...repo.row("mediaUserState", state),
              rev: Math.max(state.rev, accessRev),
              deleted: !enabled,
              data: enabled ? access.state(user) : null,
            },
          ]
        : []),
    ];
  };
  const coll = (id: string): Row[] => {
    const row = repo.playlist(id);
    if (!row) return [];
    return [
      repo.row("mediaPlaylist", row),
      ...service.options.db
        .all<{ track: string; rev: number; deleted: number }>(
          "SELECT * FROM media_playlist_tracks WHERE playlist=?",
          id,
        )
        .map((item) => {
          const track = repo.track(item.track);
          return item.deleted || !track || track.deleted
            ? {
                type: "mediaTrack",
                id: item.track,
                rev: item.rev,
                deleted: true,
                data: null,
              }
            : {
                ...repo.row("mediaTrack", track),
                rev: Math.max(item.rev, track.rev),
              };
        }),
    ];
  };
  const select = (rows: Row[], since: number, limit: number) =>
    rows
      .filter((r) => r.rev > since)
      .sort((a, b) => a.rev - b.rev || a.id.localeCompare(b.id))
      .slice(0, limit);
  hub.registerProvider({
    match: (s) => s.startsWith("me:"),
    access: (u, s) => s === `me:${u}`,
    list: (u) => [`me:${u}`],
    select: (s, n, l) => select(me(s.slice(3)), n, l),
  });
  hub.registerProvider({
    match: (s) => s.startsWith("coll:") && !!repo.playlist(s.slice(5)),
    access: (u, s) => {
      const p = repo.playlist(s.slice(5));
      return (
        !!p && !p.deleted && allowed(u, JSON.parse(p.body) as MediaPlaylist)
      );
    },
    list: (u) =>
      repo
        .playlists()
        .filter((p) => allowed(u, JSON.parse(p.body) as MediaPlaylist))
        .map((p) => `coll:${p.id}`),
    select: (s, n, l) => select(coll(s.slice(5)), n, l),
  });
  for (const type of [
    "mediaTrack",
    "mediaPlaylist",
    "mediaUserState",
    "mediaRetention",
  ])
    hub.registerEntity(type, {
      accessNeutral: ["mediaUserState", "mediaRetention"].includes(type),
      serialize: (r) => r,
      read: (scope, id) => {
        const rows = scope.startsWith("me:")
          ? me(scope.slice(3))
          : coll(scope.slice(5));
        return rows.find((r) => r.type === type && r.id === id);
      },
    });
}
