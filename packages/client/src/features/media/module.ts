import {
  contract,
  mediaUserStateSchema,
  mediaRetentionEntitySchema,
} from "@talos/contract";
import type { MediaUserState } from "@talos/contract";
import type { MediaRetention } from "@talos/contract";
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
  orderKey: (method: string, args: unknown): string => {
    if (method === "media.queue.set") return "queue";
    if (method === "media.stopAtEnd.set") return "stopAtEnd";
    if (!args || typeof args !== "object") return "";
    const input = args as Record<string, unknown>;
    if (
      method === "media.retention.set" &&
      (input.kind === "track" || input.kind === "playlist") &&
      typeof input.id === "string"
    )
      return `${input.kind}:${input.id}`;
    if (typeof input.track === "string") return `track:${input.track}`;
    if (typeof input.playlist === "string") return `playlist:${input.playlist}`;
    return "";
  },
  registers: {
    "media.queue.set": {
      key: () => "queue",
      merge: (earlier, later) => {
        const a = contract.media.queue.args.parse(earlier),
          b = contract.media.queue.args.parse(later);
        return newer(a, b) ? a : b;
      },
    },
  },
  rowTypes: ["mediaTrack", "mediaPlaylist", "mediaUserState", "mediaRetention"],
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
    "media.retention.set": (rows, args, { user }) => {
      const parsed = contract.media.retention.set.args.safeParse(args);
      if (!parsed.success) return rows;
      const input = parsed.data;
      return projectRetention(rows, user, input.id, input.kind, input.value);
    },
    "media.playlist.recordPlay": (rows, args, { user }) => {
      const parsed = contract.media.playlist.recordPlay.args.safeParse(args);
      if (!parsed.success) return rows;
      const input = parsed.data;
      return projectRetention(
        rows,
        user,
        input.playlist,
        "playlist",
        undefined,
        input.t.ms,
      );
    },
    "media.track.recordPlay": (rows, args, { user }) => {
      const parsed = contract.media.recordPlay.args.safeParse(args);
      if (!parsed.success) return rows;
      const input = parsed.data;
      return projectRetention(
        rows,
        user,
        input.track,
        "track",
        undefined,
        input.t.ms,
      );
    },
  },
  repositories: {
    data: (rows) =>
      rows.filter(
        (r) =>
          !r.deleted &&
          [
            "mediaTrack",
            "mediaPlaylist",
            "mediaUserState",
            "mediaRetention",
            "grant",
          ].includes(r.type),
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

function projectRetention(
  rows: readonly StoredRow[],
  user: string,
  id: string,
  kind: "track" | "playlist",
  value?: MediaRetention["value"],
  used = 0,
): StoredRow[] {
  const scope = `me:${user}`;
  const previous = rows.find(
    (row) =>
      row.scope === scope && row.type === "mediaRetention" && row.id === id,
  );
  const parsed = mediaRetentionEntitySchema.safeParse(previous?.data);
  const data = parsed.success
    ? parsed.data
    : { id, kind, value: null, lastUsed: 0 };
  return [
    ...rows.filter((row) => row !== previous),
    {
      scope,
      type: "mediaRetention",
      id,
      rev: previous?.rev ?? 0,
      deleted: false,
      data: {
        ...data,
        value: value && newer(value, data.value) ? value : data.value,
        lastUsed: Math.max(data.lastUsed, used),
      },
    },
  ];
}
