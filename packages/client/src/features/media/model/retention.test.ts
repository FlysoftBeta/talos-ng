import { describe, expect, it, vi } from "vitest";
import type {
  MediaPlaylist,
  MediaTrack,
  MediaRetention,
} from "@talos/contract";
import { MediaRetentionScheduler, retentionDeadline } from "./retention.ts";
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
const policy = (
  id: string,
  kind: "track" | "playlist",
  days: number | "auto",
  lastUsed = 0,
): MediaRetention => ({
  id,
  kind,
  value: { v: days, t: { ms: 1000, counter: 0 }, op: id },
  lastUsed,
});
function data(policies: MediaRetention[] = []): MediaData {
  return {
    tracks: [track("a"), track("b")],
    playlists: [
      {
        id: "p",
        owner: "other",
        title: "Shared",
        tracks: ["a"],
        created: 0,
      } as MediaPlaylist,
    ],
    retentions: new Map(policies.map((p) => [p.id, p])),
    state: null,
    rows: [],
  };
}
function setup() {
  const store = new Map<string, unknown>();
  let user = "u",
    now = 2000;
  const port = {
    getSnapshot: () => ({ user: { id: user } }),
    getLocal: vi.fn(async (k: string) => store.get(k)),
    setLocal: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
    releaseFiles: vi.fn(async () => {}),
    collectFiles: vi.fn(async () => {}),
    hasFile: vi.fn(async () => false),
    retainFile: vi.fn(async () => {}),
    downloadFile: vi.fn(async () => {}),
    setDownload: vi.fn(),
    time: () => now,
    delay: vi.fn(() => 0),
    clearDelay: vi.fn(),
    can: () => ({ ok: true }),
    command: vi.fn(async (_m: unknown, args: { track: string }) => ({
      track: track(args.track),
      download: { url: `/${args.track}` },
    })),
  };
  const scheduler = new MediaRetentionScheduler(
    port as unknown as MediaRetentionPort,
  );
  const update = (value: MediaData, offline = false) =>
    scheduler.update({ user, active: true, offline, data: value });
  return {
    port,
    store,
    scheduler,
    update,
    user: (v: string) => {
      user = v;
    },
    now: (v: number) => {
      now = v;
    },
  };
}
describe("personal media retention", () => {
  it("never downloads someone else's shared playlist by default; combines independent item/list choices by latest personal deadline", async () => {
    const t = setup();
    t.update(data());
    await t.scheduler.idle();
    expect(t.port.downloadFile).not.toHaveBeenCalled();
    const chosen = data([
      policy("p", "playlist", 7),
      policy("a", "track", 1, 5 * DAY),
      policy("b", "track", 30),
    ]);
    expect(retentionDeadline(chosen, "a")).toBe(1000 + 7 * DAY);
    t.update(chosen);
    await t.scheduler.idle();
    expect(t.port.downloadFile).toHaveBeenCalledTimes(2);
    chosen.retentions.set("a", policy("a", "track", "auto"));
    expect(retentionDeadline(chosen, "a")).toBe(1000 + 7 * DAY);
    chosen.playlists[0]!.tracks = [];
    t.update(chosen);
    await t.scheduler.idle();
    expect(t.port.releaseFiles).toHaveBeenCalledWith("media:a:retained");
  });
  it("retains cached audio without network and expires it on its personal clock", async () => {
    const t = setup();
    t.port.hasFile.mockResolvedValue(true);
    const d = data([policy("a", "track", 1)]);
    t.update(d, true);
    await t.scheduler.idle();
    expect(t.port.retainFile).toHaveBeenCalledWith("r-a", "media:a:retained");
    expect(t.port.command).not.toHaveBeenCalled();
    t.now(2 * DAY);
    t.update(d, true);
    await t.scheduler.idle();
    expect(t.port.releaseFiles).toHaveBeenCalledWith("media:a:retained");
  });
  it("registers partial downloads before a policy change, then releases them in the replacement pass", async () => {
    const t = setup();
    let finish!: () => void;
    let begin!: () => void;
    const started = new Promise<void>((r) => {
      begin = r;
    });
    t.port.downloadFile.mockImplementationOnce(() => {
      begin();
      return new Promise<void>((r) => {
        finish = r;
      });
    });
    t.update(data([policy("a", "track", 7)]));
    await started;
    expect(t.store.get("media:retained")).toEqual([
      expect.objectContaining({ track: "a" }),
    ]);
    t.update(data([policy("a", "track", "auto")]));
    finish();
    await t.scheduler.idle();
    expect(t.port.releaseFiles).toHaveBeenCalledWith("media:a:retained");
    expect(t.store.get("media:retained")).toEqual([]);
  });
  it("does not release or publish into another user's account when a download finishes", async () => {
    const t = setup();
    t.port.downloadFile.mockImplementationOnce(async () => {
      t.user("other");
      t.port.setDownload.mockClear();
    });
    t.update(data([policy("p", "playlist", 7)]));
    await t.scheduler.idle();
    expect(t.port.releaseFiles).not.toHaveBeenCalled();
    expect(t.port.setDownload).not.toHaveBeenCalled();
  });
  it("fences the initial storage read before revoked cleanup on account switch", async () => {
    const t = setup();
    t.port.getLocal.mockImplementationOnce(async () => {
      t.user("other");
      return [{ track: "a", rid: "r-a", expires: 0 }];
    });
    t.update(data());
    await t.scheduler.idle();
    expect(t.port.releaseFiles).not.toHaveBeenCalled();
    expect(t.port.setLocal).not.toHaveBeenCalled();
  });
  it("surfaces storage failures and schedules a bounded retry", async () => {
    const t = setup();
    t.port.getLocal.mockRejectedValueOnce(new Error("disk failed"));
    t.update(data());
    await t.scheduler.idle();
    expect(t.port.setDownload).toHaveBeenCalledWith(
      "media:retention",
      expect.objectContaining({ error: "disk failed" }),
    );
    expect(t.port.delay).toHaveBeenCalledWith(expect.any(Function), 30000);
  });
  it("releases direct pins when access disappears even if private policy remains", async () => {
    const t = setup();
    t.port.hasFile.mockResolvedValue(true);
    const d = data([policy("a", "track", 30)]);
    t.update(d);
    await t.scheduler.idle();
    d.tracks = [];
    t.update(d);
    await t.scheduler.idle();
    expect(t.port.releaseFiles).toHaveBeenCalledWith("media:a:retained");
  });
});
