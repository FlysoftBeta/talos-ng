import { describe, expect, it, vi } from "vitest";
import type { MediaUserState } from "@talos/contract";
import {
  QueueTracker,
  movedTrack,
  queueRows,
  withTrackFirst,
  withTrackLast,
  withoutTrackAt,
} from "./queue.ts";
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  emptyState,
  listBody,
  removeFromPlaylist,
  retentionChoices,
  saveAsPlaylist,
  searchTracks,
  validRetention,
  watchDeviceCache,
} from "./actions.ts";

const state = (queue: string[], ms: number, op: string): MediaUserState =>
  ({
    queue,
    queueStamp: { t: { ms, counter: 0 }, op },
  }) as unknown as MediaUserState;

describe("queue tracker", () => {
  it("adopts only a strictly newer synced queue over the local intent", () => {
    const q = new QueueTracker();
    q.sync("u", state(["a"], 10, "op1"));
    q.replace(["a", "b"], { t: { ms: 20, counter: 0 }, op: "op2" });
    // an older remote echo must not roll the optimistic order back
    q.sync("u", state(["a"], 10, "op1"));
    expect(q.tracks).toEqual(["a", "b"]);
    // same time: the lexically larger op id wins, an equal one is not re-adopted
    q.sync("u", state(["z"], 20, "op1"));
    expect(q.tracks).toEqual(["a", "b"]);
    q.sync("u", state(["c"], 20, "op3"));
    expect(q.tracks).toEqual(["c"]);
    q.sync("u", state(["d"], 30, "op0"));
    expect(q.tracks).toEqual(["d"]);
  });

  it("resets on account change and ignores a missing remote stamp", () => {
    const q = new QueueTracker();
    q.sync("u1", state(["a"], 10, "op"));
    q.replace(["x"], { t: { ms: 99, counter: 0 }, op: "op9" });
    q.sync("u2", state(["m"], 1, "opm"));
    expect(q.tracks).toEqual(["m"]);
    q.sync("u2", null);
    expect(q.tracks).toEqual(["m"]);
    q.sync(undefined, null);
    expect(q.tracks).toEqual([]);
  });

  it("puts a track at the front without duplicating it", () => {
    expect(withTrackFirst(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(withTrackFirst([], "x")).toEqual(["x"]);
  });
});

describe("queue edits", () => {
  it("moves within bounds only and never mutates the input", () => {
    const queue = ["a", "b", "c"];
    expect(movedTrack(queue, 0, -1)).toEqual(queue);
    expect(movedTrack(queue, 2, 1)).toEqual(queue);
    expect(movedTrack(queue, 1, -1)).toEqual(["b", "a", "c"]);
    expect(queue).toEqual(["a", "b", "c"]);
  });
  it("re-queues a track at the end exactly once and removes by index", () => {
    expect(withTrackLast(["a", "b", "a"], "a")).toEqual(["b", "a"]);
    expect(withTrackLast([], "x")).toEqual(["x"]);
    expect(withoutTrackAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    expect(withoutTrackAt(["a"], 5)).toEqual(["a"]);
  });
  it("labels rows with unknown tracks by id and flags the ends", () => {
    const rows = queueRows(["a", "b"], [{ id: "a", title: "甲" } as never]);
    expect(rows).toEqual([
      { id: "a", title: "甲", canUp: false, canDown: true },
      { id: "b", title: "b", canUp: true, canDown: false },
    ]);
  });
});

describe("media actions", () => {
  const playlist = { id: "p", tracks: ["a", "b"] } as never;
  it("adds and removes by sending the full resulting track list", async () => {
    const port = {
      command: vi.fn(async () => ({})),
      sync: vi.fn(async () => {}),
      dispatch: vi.fn(),
      operation: vi.fn(),
    };
    await addToPlaylist(port as never, playlist, "c");
    expect(port.command).toHaveBeenLastCalledWith(expect.anything(), {
      playlist: "p",
      tracks: ["a", "b", "c"],
    });
    expect(port.sync).toHaveBeenCalledOnce();
    await removeFromPlaylist(port as never, playlist, "a");
    expect(port.command).toHaveBeenLastCalledWith(expect.anything(), {
      playlist: "p",
      tracks: ["b"],
    });
  });
  it("opens a created playlist only when the server answered; offline it is queued", async () => {
    const dispatch = vi.fn();
    const online = {
      command: vi.fn(async () => ({ playlist: { id: "n" } })),
      dispatch,
    };
    expect(await createPlaylist(online as never, "  歌单 ")).toBe(true);
    expect(online.command).toHaveBeenCalledWith(expect.anything(), {
      title: "歌单",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "pushPage",
      area: "media",
      page: { kind: "page", id: "playlist:n" },
    });
    dispatch.mockClear();
    const offline = {
      command: vi.fn(async () => ({ queued: true })),
      dispatch,
    };
    expect(await createPlaylist(offline as never, "x")).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("leaves the playlist page after deletion and rejects a queued search", async () => {
    const dispatch = vi.fn();
    await deletePlaylist(
      { command: vi.fn(async () => ({})), dispatch } as never,
      "p",
    );
    expect(dispatch).toHaveBeenCalledWith({ type: "back" });
    await expect(
      searchTracks({ command: async () => ({ queued: true }) } as never, "x"),
    ).rejects.toThrow("搜索尚未完成");
  });
  it("saves a collection as a new playlist, truncating the title, then opens it", async () => {
    const command = vi.fn(async (...call: [{ name: string }, unknown?]) =>
      call[0].name === "media.playlist.create"
        ? { playlist: { id: "p1", title: "x", tracks: [] } }
        : {},
    );
    const dispatch = vi.fn();
    const sync = vi.fn(async () => {});
    const ok = await saveAsPlaylist(
      { command, dispatch, sync } as never,
      "很长".repeat(60),
      ["t1", "t2"],
    );
    expect(ok).toBe(true);
    expect(command.mock.calls[0]![1]).toEqual({ title: "很长".repeat(40) });
    expect(command.mock.calls[1]![1]).toEqual({
      playlist: "p1",
      tracks: ["t1", "t2"],
    });
    expect(dispatch).toHaveBeenCalled();
    command.mockResolvedValueOnce({ queued: true } as never);
    expect(
      await saveAsPlaylist({ command, dispatch, sync } as never, "x", ["t"]),
    ).toBe(false);
  });
  it("validates and lists retention choices", () => {
    expect(retentionChoices(45)).toEqual(["auto", 1, 7, 30, 45, 90, 365]);
    expect(retentionChoices(30)).toEqual(["auto", 1, 7, 30, 90, 365]);
    for (const [v, ok] of [
      [0, false],
      [1, true],
      [365, true],
      [366, false],
      [1.5, false],
      [Number.NaN, false],
    ] as const)
      expect(validRetention(v)).toBe(ok);
  });
  it("chooses the list body from tab and request state", () => {
    expect(
      listBody({ tab: "playlist", busy: true, error: "x", tracks: 0 }),
    ).toBe("playlists");
    expect(listBody({ tab: "search", busy: true, error: "", tracks: 3 })).toBe(
      "loading",
    );
    expect(
      listBody({ tab: "recent", busy: true, error: "bad", tracks: 3 }),
    ).toBe("error");
    expect(listBody({ tab: "recent", busy: false, error: "", tracks: 0 })).toBe(
      "empty",
    );
    expect(
      listBody({ tab: "favorite", busy: false, error: "", tracks: 1 }),
    ).toBe("tracks");
  });
  it("device cache watcher reports false first and drops a late answer after cancel", async () => {
    let resolve!: (v: boolean) => void;
    const hasFile = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
    const seen: boolean[] = [];
    const stop = watchDeviceCache({ hasFile }, "rid", (c) => seen.push(c));
    expect(seen).toEqual([false]);
    stop();
    resolve(true);
    await Promise.resolve();
    expect(seen).toEqual([false]);
    const none: boolean[] = [];
    watchDeviceCache({ hasFile }, undefined, (c) => none.push(c));
    expect(none).toEqual([false]);
  });
});

it("distinguishes unsynced empty music from cached tracks and completed search results", () => {
  for (const connection of ["connecting", "syncing"]) {
    expect(emptyState(connection)).toBe("loading");
    expect(
      listBody({
        tab: "recent",
        busy: false,
        error: "",
        tracks: 0,
        connection,
      }),
    ).toBe("loading");
    expect(
      listBody({
        tab: "favorite",
        busy: false,
        error: "",
        tracks: 1,
        connection,
      }),
    ).toBe("tracks");
    expect(
      listBody({
        tab: "search",
        busy: false,
        error: "",
        tracks: 0,
        connection,
      }),
    ).toBe("empty");
  }
  expect(
    listBody({
      tab: "recent",
      busy: false,
      error: "",
      tracks: 0,
      connection: "offline",
    }),
  ).toBe("offline");
  expect(
    listBody({
      tab: "recent",
      busy: false,
      error: "",
      tracks: 0,
      connection: "connected",
    }),
  ).toBe("empty");
});
