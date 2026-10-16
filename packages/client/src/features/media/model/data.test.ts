import { describe, expect, it } from "vitest";
import { createUlid } from "@talos/base";
import { mediaModule } from "../module.ts";
import { canEditPlaylist, decodeMedia } from "./data.ts";
const id = createUlid();
describe("media offline projection", () => {
  it("keeps the newest favorite, queue, and end behavior without mutating authoritative rows", () => {
    const user = id(),
      track = id(),
      newer = { t: { ms: 20, counter: 0 }, op: id() },
      older = { t: { ms: 10, counter: 0 }, op: id() };
    const context = { user, op: id() };
    const start = [
      {
        scope: `me:${user}`,
        type: "mediaTrack",
        id: track,
        rev: 1,
        deleted: false,
        data: {
          id: track,
          source: "fake",
          providerId: "track",
          title: "曲目",
          artists: [],
          album: null,
          durationMs: 1000,
          audio: null,
        },
      },
    ];
    const favorite = mediaModule.reducers["media.favorite.set"]!;
    const queue = mediaModule.reducers["media.queue.set"]!;
    const end = mediaModule.reducers["media.stopAtEnd.set"]!;
    const a = favorite(start, { track, value: { v: true, ...newer } }, context);
    const b = favorite(a, { track, value: { v: false, ...older } }, context);
    const c = queue(b, { tracks: [track], ...newer }, context);
    const d = queue(c, { tracks: [], ...older }, context);
    const e = end(d, { value: true, ...newer }, context);
    expect(decodeMedia(e).state).toMatchObject({
      favorites: { [track]: { v: true } },
      queue: [track],
      stopAtEnd: true,
    });
    expect(start).toHaveLength(1);
    expect(start[0]!.type).toBe("mediaTrack");
    const revoked = decodeMedia(e.filter((row) => row.type !== "mediaTrack"));
    expect(revoked.state?.queue).toEqual([]);
    expect(revoked.state?.favorites).toEqual({});
  });
  it("extends playlist retention from a queued offline play", () => {
    const user = id(),
      playlist = id();
    const source = [
      {
        scope: `me:${user}`,
        type: "mediaPlaylist",
        id: playlist,
        rev: 1,
        deleted: false,
        data: {
          id: playlist,
          owner: user,
          title: "测试",
          tracks: [],
          created: 1,
        },
      },
    ];
    const result = mediaModule.reducers["media.playlist.recordPlay"]!(
      source,
      { playlist, t: { ms: 20, counter: 0 }, op: id() },
      { user, op: id() },
    );
    expect(decodeMedia(result, user).retentions.get(playlist)?.lastUsed).toBe(
      20,
    );
    expect(result[0]).toEqual(source[0]);
    expect(decodeMedia(result, id()).retentions.size).toBe(0);
  });
});
describe("playlist write access", () => {
  it("follows grants: write/own allow editing, revocation removes it", () => {
    const owner = id(),
      other = id(),
      playlist = {
        id: id(),
        owner,
        title: "歌单",
        tracks: [],
        created: 1,
      };
    const grant = (level: string) => ({
      scope: "x",
      type: "grant",
      id: id(),
      rev: 1,
      deleted: false,
      data: { resource: `coll:${playlist.id}`, level },
    });
    expect(canEditPlaylist({ rows: [] }, playlist, owner)).toBe(true);
    expect(canEditPlaylist({ rows: [] }, playlist, other)).toBe(false);
    expect(canEditPlaylist({ rows: [grant("read")] }, playlist, other)).toBe(
      false,
    );
    expect(canEditPlaylist({ rows: [grant("write")] }, playlist, other)).toBe(
      true,
    );
  });
});

it("offers tracks only from the selected accessible playlist or live search results, including after reclamation", async () => {
  const { addableTracks, tabTracks } = await import("./actions.ts");
  const user = id();
  const song = (title: string) => ({
    id: id(),
    source: "fake",
    providerId: title,
    title,
    artists: [],
    album: null,
    durationMs: 1000,
    audio: null,
  });
  const searched = song("搜索"),
    shared = song("歌单"),
    unrelated = song("其他本地曲目");
  const target = {
    id: id(),
    owner: user,
    title: "目标",
    tracks: [],
    created: 1,
  };
  const source = { ...target, id: id(), title: "来源", tracks: [shared.id] };
  const data = {
    retentions: new Map(),
    tracks: [searched, shared, unrelated],
    playlists: [target, source],
    state: null,
    rows: [],
  };
  expect(addableTracks(data, target, "search", [searched])).toEqual([searched]);
  expect(addableTracks(data, target, source.id, [searched])).toEqual([shared]);
  expect(addableTracks(data, target, "unknown", [searched])).toEqual([]);
  expect(
    addableTracks(data, { ...target, tracks: [shared.id] }, source.id, [
      searched,
    ]),
  ).toEqual([]);
  const expired = { ...data, tracks: [shared, unrelated] };
  expect(tabTracks("search", expired, [searched])).toEqual([]);
  expect(addableTracks(expired, target, "search", [searched])).toEqual([]);
  const revoked = {
    ...data,
    playlists: [target],
    tracks: [searched, unrelated],
  };
  expect(addableTracks(revoked, target, source.id, [searched])).toEqual([]);
});
