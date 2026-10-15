import { describe, expect, it, vi } from "vitest";
import type { MediaPlaylist, MediaTrack } from "@talos/contract";
import { MediaRetentionScheduler } from "./retention.ts";
import type { MediaRetentionPort } from "./retention.ts";
import type { MediaData } from "./data.ts";

const DAY = 86400000;
const track = (id: string): MediaTrack =>
  ({
    id,
    title: id,
    artists: [],
    audio: { id: `r-${id}`, size: 1, mime: "audio/wav" },
  }) as unknown as MediaTrack;
const playlist = (patch: Partial<MediaPlaylist>): MediaPlaylist => ({
  id: "p",
  owner: "u",
  title: "p",
  tracks: ["a"],
  retentionDays: 1,
  lastPlayed: 0,
  created: 1000,
  ...patch,
});
function setup(local: unknown[], now: number, files: string[] = []) {
  const store = new Map<string, unknown>([["media:retained", local]]);
  let user = "u";
  const port = {
    getSnapshot: () => ({ user: { id: user } }),
    getLocal: async (k: string) => store.get(k),
    setLocal: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
    releaseFiles: vi.fn(async () => {}),
    collectFiles: vi.fn(async () => {}),
    hasFile: async (rid: string) => files.includes(rid),
    retainFile: vi.fn(async () => {}),
    downloadFile: vi.fn(async () => {
      user = "other";
    }),
    setDownload: vi.fn(),
    time: () => now,
    can: () => ({ ok: true }),
    command: vi.fn(async () => ({
      track: track("a"),
      download: { url: "/a" },
    })),
  } as unknown as MediaRetentionPort & Record<string, ReturnType<typeof vi.fn>>;
  return { port, store };
}
const data = (p: MediaPlaylist): MediaData => ({
  tracks: [track("a")],
  playlists: [p],
  state: null,
  rows: [],
});

describe("media retention scheduler", () => {
  it("releases expired and removed members, keeps live ones", async () => {
    const { port, store } = setup(
      [
        { playlist: "p", track: "a", rid: "r-a", expires: 0 },
        { playlist: "p", track: "gone", rid: "r-gone", expires: 0 },
      ],
      1000 + DAY / 2,
      ["r-a"],
    );
    const scheduler = new MediaRetentionScheduler(port);
    scheduler.update({
      user: "u",
      active: true,
      offline: true,
      data: data(playlist({})),
    });
    await scheduler.idle();
    expect(port.releaseFiles).toHaveBeenCalledTimes(1);
    expect(port.releaseFiles).toHaveBeenCalledWith("coll:p:media:gone");
    expect(store.get("media:retained")).toEqual([
      expect.objectContaining({ track: "a", expires: 1000 + DAY }),
    ]);
  });

  it("releases a download that completes after the account changed", async () => {
    const { port } = setup([], 2000);
    const scheduler = new MediaRetentionScheduler(port);
    scheduler.update({
      user: "u",
      active: true,
      offline: false,
      data: data(playlist({})),
    });
    await scheduler.idle();
    expect(port.downloadFile).toHaveBeenCalled();
    expect(port.releaseFiles).toHaveBeenCalledWith("coll:p:media:a");
    expect(port.setDownload).toHaveBeenLastCalledWith(
      "coll:p:media:a",
      undefined,
    );
  });

  it("does nothing offline apart from housekeeping", async () => {
    const { port } = setup([], 2000);
    const scheduler = new MediaRetentionScheduler(port);
    scheduler.update({
      user: "u",
      active: true,
      offline: true,
      data: data(playlist({})),
    });
    await scheduler.idle();
    expect(port.downloadFile).not.toHaveBeenCalled();
  });
});
