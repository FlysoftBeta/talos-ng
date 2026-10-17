import { describe, expect, it, vi } from "vitest";
import { AppError } from "@talos/base";
import type { MediaTrack } from "@talos/contract";
import { PlaybackController } from "./playback.ts";
import type { AudioPort, PlaybackInput, PlaybackPort } from "./playback.ts";

const bytes = new Uint8Array([1, 2, 3]);
const track = (id: string): MediaTrack =>
  ({
    id,
    source: "fake",
    providerId: id,
    title: id,
    artists: [],
    album: null,
    durationMs: 4000,
    audio: { id: "hash", size: 3, mime: "audio/wav" },
  }) as MediaTrack;

function setup(init: Partial<PlaybackInput> = {}) {
  const local = new Map<string, unknown>();
  const volumes: number[] = [];
  const loaded: string[] = [];
  const audio: AudioPort = {
    ready: () => true,
    load: (_b, mime) => void loaded.push(mime),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    seek: (s) => s,
    setVolume: (v) => void volumes.push(v),
    duration: 4,
  };
  const command = vi.fn();
  let cached: Uint8Array | undefined = bytes;
  const port = {
    command,
    operation: () => ({ op: "op", t: { ms: 1, counter: 0 } }),
    getLocal: async (k: string) => local.get(k),
    setLocal: async (k: string, v: unknown) => void local.set(k, v),
    readFile: async () => cached,
    delay: (cb: () => void) => void cb(),
  } as unknown as PlaybackPort;
  const download = { ok: true, status: 200, read: async () => bytes };
  const transfer = {
    fetch: vi.fn(async () => download),
    sha256: async () => "hash",
  };
  const session = { playing: vi.fn(), paused: vi.fn() };
  const controller = new PlaybackController(port, audio, transfer, session);
  const tracks = [track("a"), track("b")];
  const input: PlaybackInput = {
    user: "u",
    offline: false,
    active: true,
    tracks,
    state: null,
    queueReady: true,
    ...init,
  };
  controller.setInput(input);
  controller.inputChanged();
  return {
    controller,
    audio,
    command,
    local,
    volumes,
    loaded,
    session,
    transfer,
    tracks,
    input,
    dropCache: () => (cached = undefined),
  };
}
const granted = (maxVolume = 0.5) => ({
  track: track("a"),
  maxVolume,
  download: { url: "/audio" },
});

describe("playback controller", () => {
  it("never starts a track whose preparation finished after the session was locked", async () => {
    const t = setup();
    let release!: (v: unknown) => void;
    t.command.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const started = t.controller.play(t.tracks[0]!);
    await Promise.resolve();
    t.controller.setInput({ ...t.input, active: false });
    t.controller.inputChanged();
    release(granted());
    await started;
    expect(t.audio.play).not.toHaveBeenCalled();
    expect(t.controller.getState().playing).toBe(false);
  });

  it("restores the persisted volume cap offline and persists the server's cap online", async () => {
    const offline = setup({ offline: true });
    offline.local.set("media:volume-cap", 0.3);
    await offline.controller.play(offline.tracks[0]!);
    expect(offline.controller.getState().maxVolume).toBe(0.3);
    expect(offline.volumes.at(-1)).toBeCloseTo(0.3);
    expect(
      offline.command.mock.calls.map(
        (call) => (call[0] as { name: string }).name,
      ),
    ).toEqual(["media.track.recordPlay"]);
    const online = setup();
    online.command.mockResolvedValue(granted(0.2));
    await online.controller.play(online.tracks[0]!);
    expect(online.local.get("media:volume-cap")).toBe(0.2);
    expect(online.volumes.at(-1)).toBeCloseTo(0.2);
    expect(online.session.playing).toHaveBeenCalled();
  });

  it("advances on ended unless play-to-end stop is set, and stops at the queue end", async () => {
    const queue = ["a", "b"];
    const state = {
      queue,
      stopAtEnd: false,
      queueStamp: { t: { ms: 5, counter: 0 }, op: "x" },
    } as never;
    const t = setup({ state, offline: true });
    await t.controller.play(t.tracks[0]!);
    t.controller.ended();
    await vi.waitFor(() =>
      expect(t.controller.getState().current?.id).toBe("b"),
    );
    t.controller.ended();
    await vi.waitFor(() => expect(t.controller.getState().playing).toBe(false));
    expect(t.controller.getState().current?.id).toBe("b");
    const stop = setup({
      state: { ...(state as object), stopAtEnd: true } as never,
      offline: true,
    });
    await stop.controller.play(stop.tracks[0]!);
    stop.controller.ended();
    await Promise.resolve();
    expect(stop.controller.getState().current?.id).toBe("a");
  });

  it("reports a failed download without a cache and plays again on retry", async () => {
    const t = setup();
    t.dropCache();
    t.command.mockResolvedValue(granted());
    t.transfer.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      read: async () => bytes,
    });
    await t.controller.play(t.tracks[0]!);
    expect(t.controller.getState()).toMatchObject({
      current: null,
      error: "音频下载失败",
    });
    await t.controller.play(t.tracks[0]!);
    expect(t.controller.getState()).toMatchObject({
      playing: true,
      error: "",
    });
  });

  it("drops a revoked current track and falls back to cached bytes only for transient errors", async () => {
    const t = setup();
    t.command.mockRejectedValueOnce(new AppError("E_UNAVAILABLE", "离线"));
    await t.controller.play(t.tracks[0]!);
    expect(t.controller.getState().playing).toBe(true);
    t.controller.setInput({ ...t.input, tracks: [t.tracks[1]!] });
    t.controller.inputChanged();
    expect(t.controller.getState().current).toBeNull();
  });
});

describe("playback transport edge cases", () => {
  it("refuses to start when neither the download nor the cache matches the declared hash", async () => {
    const t = setup();
    t.command.mockResolvedValue(granted());
    t.transfer.sha256 = vi.fn(async () => "tampered");
    await t.controller.play(t.tracks[0]!);
    // the cached copy also fails verification here, so nothing may start
    expect(t.audio.play).not.toHaveBeenCalled();
    expect(t.controller.getState().playing).toBe(false);
  });

  it("polls a preparing audio job until a ticket is ready, then plays", async () => {
    const t = setup();
    t.command
      .mockResolvedValueOnce({ track: track("a"), maxVolume: 1, job: "j" })
      .mockResolvedValueOnce({ track: track("a"), maxVolume: 1, job: "j" })
      .mockResolvedValueOnce(granted(1));
    await t.controller.play(t.tracks[0]!);
    expect(
      t.command.mock.calls.filter(
        (call) => (call[0] as { name: string }).name === "media.track.play",
      ),
    ).toHaveLength(3);
    expect(t.controller.getState().playing).toBe(true);
  });

  it("stops polling a job when the user starts something else", async () => {
    const t = setup();
    t.command.mockResolvedValue({ track: track("a"), maxVolume: 1, job: "j" });
    let tick = 0;
    (
      t as unknown as {
        controller: { port: { delay: (cb: () => void) => void } };
      }
    ).controller.port.delay = (cb) => {
      if (++tick === 2) t.controller.stop();
      cb();
    };
    await t.controller.play(t.tracks[0]!);
    expect(tick).toBeLessThan(30);
    expect(t.controller.getState().playing).toBe(false);
  });

  it("reports a queued play request and an unavailable download without leaving a half-started track", async () => {
    const queued = setup({ offline: false });
    queued.command.mockResolvedValue({ queued: "op" });
    queued.dropCache();
    await queued.controller.play(queued.tracks[0]!);
    expect(queued.controller.getState()).toMatchObject({
      current: null,
      playing: false,
    });
    expect(queued.controller.getState().error).not.toBe("");
    const down = setup();
    down.dropCache();
    down.command.mockResolvedValue(granted());
    down.transfer.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      read: async () => bytes,
    });
    await down.controller.play(down.tracks[0]!);
    expect(down.controller.getState()).toMatchObject({
      current: null,
      error: "音频下载失败",
    });
  });

  it("offline with no cached bytes reports it and an unlisted track is refused", async () => {
    const t = setup({ offline: true });
    t.dropCache();
    await t.controller.play(t.tracks[0]!);
    expect(t.controller.getState().error).toBe("离线未缓存或音频尚未准备好");
    await t.controller.play(track("unknown"));
    expect(t.controller.getState().error).toBe("没有此曲目的访问权限");
  });

  it("surfaces an audio start failure and resumes with the same message path", async () => {
    const t = setup();
    t.command.mockResolvedValue(granted());
    (t.audio.play as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("blocked"),
    );
    await t.controller.play(t.tracks[0]!);
    expect(t.controller.getState()).toMatchObject({
      playing: false,
      error: "blocked",
    });
    (t.audio.play as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("still blocked"),
    );
    await t.controller.resume();
    expect(t.controller.getState().error).toBe("still blocked");
    await t.controller.resume();
    expect(t.controller.getState().playing).toBe(true);
  });

  it("pauses a start that was superseded while the audio element was starting", async () => {
    const t = setup();
    t.command.mockResolvedValue(granted());
    (t.audio.play as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => {
        t.controller.stop();
      },
    );
    await t.controller.play(t.tracks[0]!);
    expect(t.audio.pause).toHaveBeenCalled();
    expect(t.controller.getState().playing).toBe(false);
  });

  it("advances to the next queued track on end unless stop-at-end is set", async () => {
    const queue = ["a", "b"];
    const state = { queue, queueStamp: null, stopAtEnd: false } as never;
    const t = setup({ state });
    t.command.mockResolvedValue(granted());
    await t.controller.play(t.tracks[0]!);
    t.command.mockResolvedValue({ ...granted(), track: track("b") });
    t.controller.ended();
    await vi.waitFor(() =>
      expect(t.controller.getState().current?.id).toBe("b"),
    );
    const stopping = setup({
      state: { queue, queueStamp: null, stopAtEnd: true } as never,
    });
    stopping.command.mockResolvedValue(granted());
    await stopping.controller.play(stopping.tracks[0]!);
    stopping.controller.ended();
    await Promise.resolve();
    expect(stopping.controller.getState()).toMatchObject({
      current: { id: "a" },
      playing: false,
    });
  });

  it("at the end of the queue next pauses and rewinds; previous at the start does nothing", async () => {
    const t = setup({
      state: { queue: ["a", "b"], queueStamp: null, stopAtEnd: false } as never,
    });
    t.command.mockResolvedValue({ ...granted(), track: track("b") });
    await t.controller.play(t.tracks[1]!);
    t.controller.timeUpdate(2);
    await t.controller.next();
    expect(t.controller.getState()).toMatchObject({
      playing: false,
      position: 0,
    });
    t.command.mockResolvedValue(granted());
    await t.controller.play(t.tracks[0]!);
    await t.controller.previous();
    expect(t.controller.getState().current?.id).toBe("a");
    await setup().controller.next(); // nothing playing: no-op
  });

  it("clamps volume, applies the cap, and ignores seeks that are not finite or not ready", async () => {
    const t = setup();
    t.command.mockResolvedValue(granted(0.4));
    await t.controller.play(t.tracks[0]!);
    t.controller.setVolume(9);
    expect(t.controller.getState().volume).toBe(1);
    expect(t.volumes.at(-1)).toBeCloseTo(0.4);
    t.controller.setVolume(-3);
    expect(t.controller.getState().volume).toBe(0);
    t.controller.seek(Number.NaN);
    expect(t.controller.getState().position).toBe(0);
    t.controller.seek(2);
    expect(t.controller.getState().position).toBe(2);
    t.controller.durationChange(Number.POSITIVE_INFINITY);
    expect(t.controller.getState().duration).toBe(0);
    t.controller.outputFailed();
    expect(t.controller.getState().error).toBe("音频播放中断");
  });

  it("preserves an unseen queue during partial sync without blocking direct playback", async () => {
    const t = setup({ queueReady: false });
    t.command.mockResolvedValue(granted());
    t.controller.enqueue("a");
    t.controller.moveQueued(0, 1);
    t.controller.removeQueued(0);
    t.controller.clearQueue();
    expect(t.command).not.toHaveBeenCalled();
    expect(t.controller.queueTracks).toEqual([]);
    expect(t.controller.getState().error).toContain("尚未同步");
    await t.controller.play(t.tracks[0]!);
    expect(t.controller.getState().playing).toBe(true);
    t.controller.setInput({
      ...t.input,
      queueReady: true,
      state: {
        queue: ["b"],
        queueStamp: { t: { ms: 0, counter: 0 }, op: "server" },
      } as never,
    });
    t.controller.enqueue("a");
    expect(t.controller.queueTracks).toEqual(["b", "a"]);
    expect(t.command).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ tracks: ["b", "a"] }),
    );
  });

  it("requires a complete cache even with a partial state row, but permits known empty and offline queues", () => {
    const t = setup({
      queueReady: false,
      state: { queue: ["a"], queueStamp: null } as never,
    });
    t.command.mockResolvedValue({});
    t.controller.enqueue("b");
    expect(t.command).not.toHaveBeenCalled();
    expect(t.controller.queueTracks).toEqual(["a"]);
    t.controller.setInput({ ...t.input, offline: true, queueReady: true });
    t.controller.enqueue("b");
    expect(t.controller.queueTracks).toEqual(["a", "b"]);
    t.controller.setInput({
      ...t.input,
      user: "other",
      state: null,
      queueReady: false,
    });
    t.command.mockClear();
    t.controller.enqueue("a");
    expect(t.command).not.toHaveBeenCalled();
    t.controller.setInput({
      ...t.input,
      user: "other",
      state: null,
      queueReady: true,
    });
    t.controller.enqueue("a");
    expect(t.controller.queueTracks).toEqual(["a"]);
    expect(t.command).toHaveBeenCalledTimes(1);
  });

  it("queue edits send the new order with an operation id and surface failures", async () => {
    const t = setup({
      state: {
        queue: ["a", "b", "c"],
        queueStamp: null,
        stopAtEnd: false,
      } as never,
    });
    t.command.mockResolvedValue({});
    t.controller.moveQueued(0, 1);
    expect(t.controller.queueTracks).toEqual(["b", "a", "c"]);
    expect(t.command).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ tracks: ["b", "a", "c"], op: "op" }),
    );
    t.command.mockRejectedValueOnce(new Error("队列更新失败"));
    t.controller.removeQueued(1);
    await vi.waitFor(() =>
      expect(t.controller.getState().error).toBe("队列更新失败"),
    );
    t.controller.enqueue("a");
    t.controller.clearQueue();
    expect(t.controller.queueTracks).toEqual([]);
    t.controller.toggleQueue();
    expect(t.controller.getState().queueOpen).toBe(true);
    t.controller.closeQueue();
    expect(t.controller.getState().queueOpen).toBe(false);
  });

  it("play all starts the first track and queues the rest; enqueue all skips queued ones", async () => {
    const t = setup({ state: { queue: [], queueStamp: null } as never });
    t.command.mockResolvedValue(granted());
    await t.controller.playAll([track("a"), track("b"), track("c")]);
    expect(t.controller.getState().current?.id).toBe("a");
    expect(t.controller.queueTracks).toEqual(["b", "c"]);
    t.controller.enqueueAll(["c", "d", "e"]);
    expect(t.controller.queueTracks).toEqual(["b", "c", "d", "e"]);
    await t.controller.playAll([]);
    expect(t.controller.getState().current?.id).toBe("a");
  });
});
