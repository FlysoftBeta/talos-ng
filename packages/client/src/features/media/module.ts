import {
  contract,
  mediaUserStateSchema,
  mediaPlaylistSchema,
} from "@talos/contract";
import type { MediaUserState } from "@talos/contract";
import { compareStamp } from "@talos/base";
import { defineClientModule } from "../../core/data/modules.ts";
import type { StoredRow } from "../../core/data/db.ts";
const newer = (
  a: { t: { ms: number; counter: number }; op: string },
  b: { t: { ms: number; counter: number }; op: string } | null,
): boolean =>
  !b ||
  compareStamp(a.t, b.t) > 0 ||
  (compareStamp(a.t, b.t) === 0 && a.op > b.op);
const initial = (user: string): MediaUserState => ({
  id: user,
  favorites: {},
  queue: [],
  queueStamp: null,
  recents: [],
  stopAtEnd: false,
  stopStamp: null,
});
export const mediaModule = defineClientModule({
  id: "media",
  rowTypes: ["mediaTrack", "mediaPlaylist", "mediaUserState"],
  reducers: {
    "media.favorite.set": (rows, args, { user }) =>
      project(rows, user, (state) => {
        const value = contract.media.favorite.args.safeParse(args);
        if (
          !value.success ||
          !newer(value.data.value, state.favorites[value.data.track] ?? null)
        )
          return state;
        return {
          ...state,
          favorites: {
            ...state.favorites,
            [value.data.track]: value.data.value,
          },
        };
      }),
    "media.queue.set": (rows, args, { user }) =>
      project(rows, user, (state) => {
        const value = contract.media.queue.args.safeParse(args);
        if (!value.success || !newer(value.data, state.queueStamp))
          return state;
        return {
          ...state,
          queue: value.data.tracks,
          queueStamp: { t: value.data.t, op: value.data.op },
        };
      }),
    "media.stopAtEnd.set": (rows, args, { user }) =>
      project(rows, user, (state) => {
        const value = contract.media.stopAtEnd.args.safeParse(args);
        if (!value.success || !newer(value.data, state.stopStamp)) return state;
        return {
          ...state,
          stopAtEnd: value.data.value,
          stopStamp: { t: value.data.t, op: value.data.op },
        };
      }),
    "media.playlist.recordPlay": (rows, args, { user }) => {
      const value = contract.media.playlist.recordPlay.args.safeParse(args);
      if (!value.success) return rows;
      const previous = rows.find(
        (r) =>
          r.type === "mediaPlaylist" &&
          r.id === value.data.playlist &&
          !r.deleted,
      );
      const parsed = mediaPlaylistSchema.safeParse(previous?.data);
      if (!parsed.success) return rows;
      const scope = `me:${user}`;
      return [
        ...rows.filter(
          (r) =>
            !(
              r.scope === scope &&
              r.type === "mediaPlaylist" &&
              r.id === value.data.playlist
            ),
        ),
        {
          scope,
          type: "mediaPlaylist",
          id: value.data.playlist,
          rev: previous?.rev ?? 0,
          deleted: false,
          data: {
            ...parsed.data,
            lastPlayed: Math.max(parsed.data.lastPlayed, value.data.t.ms),
          },
        },
      ];
    },
  },
  repositories: {
    data: (rows) =>
      rows.filter(
        (r) =>
          !r.deleted &&
          ["mediaTrack", "mediaPlaylist", "mediaUserState", "grant"].includes(
            r.type,
          ),
      ),
  },
});
function project(
  rows: readonly StoredRow[],
  user: string,
  reduce: (s: MediaUserState) => MediaUserState,
): StoredRow[] {
  const scope = `me:${user}`;
  const previous = rows.find(
    (r) => r.scope === scope && r.type === "mediaUserState" && r.id === user,
  );
  const parsed = mediaUserStateSchema.safeParse(previous?.data);
  const data = reduce(parsed.success ? parsed.data : initial(user));
  return [
    ...rows.filter((r) => r !== previous),
    {
      scope,
      type: "mediaUserState",
      id: user,
      rev: previous?.rev ?? 0,
      deleted: false,
      data,
    },
  ];
}
