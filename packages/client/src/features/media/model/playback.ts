import { AppError } from "@talos/base";
import { contract } from "@talos/contract";
import type { MediaTrack, MediaUserState } from "@talos/contract";
import type {
  RuntimeClockPort,
  RuntimeCommandPort,
  RuntimeFilePort,
} from "../../../core/runtime-port.ts";
import {
  QueueTracker,
  movedTrack,
  withTrackFirst,
  withTrackLast,
  withoutTrackAt,
} from "./queue.ts";
import {
  advance,
  jumpUpcoming,
  moveUpcoming,
  openContext,
  removeUpcoming,
  retreat,
  upcoming,
  withShuffle,
} from "./play-queue.ts";
import type { PlayContext, Random, Repeat } from "./play-queue.ts";

/** The audio output. Only its adapter touches the element and object URLs. */
export interface AudioPort {
  /** False until the output exists (the element is mounted). */
  ready(): boolean;
  /** Replaces the loaded source; the previous temporary URL is released. */
  load(bytes: Uint8Array, mime: string): void;
  play(): Promise<void>;
  pause(): void;
  /** Pauses and unloads the source. */
  stop(): void;
  /** Pauses and releases everything; the port is not used afterwards. */
  dispose(): void;
  /** Moves within the loaded media and returns the resulting position. */
  seek(seconds: number): number;
  setVolume(value: number): void;
  readonly duration: number;
}
export interface AudioDownload {
  ok: boolean;
  status: number;
  read(): Promise<Uint8Array>;
}
/** Network and hashing capabilities of audio preparation. */
export interface AudioTransfer {
  fetch(url: string): Promise<AudioDownload>;
  sha256(bytes: Uint8Array): Promise<string>;
}
/** Optional OS media controls. */
export interface MediaSessionPort {
  playing(track: MediaTrack): void;
  paused(): void;
}
export type PlaybackPort = Pick<RuntimeCommandPort, "command" | "operation"> &
  Pick<RuntimeFilePort, "getLocal" | "setLocal" | "readFile"> &
  Pick<RuntimeClockPort, "delay">;
export interface PlaybackInput {
  user: string | undefined;
  offline: boolean;
  /** Unlocked, signed in and not concealed. */
  active: boolean;
  tracks: readonly MediaTrack[];
  state: MediaUserState | null;
  /** Complete cached rows establish the queue even when no personal state exists yet. */
  queueReady: boolean;
}
export interface PlaybackState {
  current: MediaTrack | null;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  /** Server-imposed upper bound on the volume. */
  maxVolume: number;
  error: string;
  queueOpen: boolean;
  /** Shuffle and repeat apply to the context only, never to the user queue. */
  shuffle: boolean;
  repeat: Repeat;
  /** Title of the list playback started from; empty without a context. */
  contextTitle: string;
  /** Ids still to come from the context ("Next from <context>"). */
  upcoming: readonly string[];
}
export interface PlayerApi extends PlaybackState {
  /** Plays a track; when `list` is given it becomes the context, starting at the track. */
  play(
    track: MediaTrack,
    list?: { title: string; tracks: readonly MediaTrack[] },
  ): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  stop(): void;
  seek(seconds: number): void;
  setVolume(value: number): void;
  toggleQueue(): void;
  enqueue(track: string): void;
  /** Puts a track at the front of the queue, to play right after the current one. */
  playNext(track: string): void;
  /** Adds several tracks to the end of the queue, skipping the ones already queued. */
  enqueueAll(tracks: readonly string[]): void;
  /** Starts a list: its first track plays and the list becomes the context. */
  playAll(title: string, tracks: readonly MediaTrack[]): Promise<void>;
  setShuffle(value: boolean): void;
  setRepeat(value: Repeat): void;
}
const CAP_KEY = "media:volume-cap";
const message = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;
const copyOf = (bytes: Uint8Array): Uint8Array => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
};

/**
 * Plays one track at a time: verified cached bytes or a fresh ticketed download, the
 * server volume cap, queue progression and OS media controls. Every asynchronous step
 * re-checks the generation so a superseded or cancelled start never reaches the output.
 */
export class PlaybackController {
  private listeners = new Set<() => void>();
  private generation = 0;
  private queue = new QueueTracker();
  private input: PlaybackInput = {
    user: undefined,
    offline: false,
    active: true,
    tracks: [],
    state: null,
    queueReady: false,
  };
  private wasActive: boolean | undefined;
  private state: PlaybackState = {
    current: null,
    playing: false,
    position: 0,
    duration: 0,
    volume: 0.7,
    maxVolume: 1,
    error: "",
    queueOpen: false,
    shuffle: false,
    repeat: "off",
    contextTitle: "",
    upcoming: [],
  };
  private context: PlayContext | null = null;
  /** The current track was taken from the user queue. */
  private fromQueue = false;
  constructor(
    private readonly port: PlaybackPort,
    private readonly audio: AudioPort,
    private readonly transfer: AudioTransfer,
    private readonly session: MediaSessionPort,
    private readonly random: Random = Math.random,
  ) {}
  getState = (): PlaybackState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private patch(value: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...value };
    this.listeners.forEach((listener) => listener());
  }
  get queueTracks(): readonly string[] {
    return this.queue.tracks;
  }
  /** Records the latest synced data; cheap and silent, safe to call while rendering. */
  setInput(input: PlaybackInput): void {
    this.input = input;
    this.queue.sync(input.user, input.state);
  }
  /** Reacts to the latest input: drops a revoked current track, pauses when concealed. */
  inputChanged(): void {
    const { current } = this.state;
    if (current && !this.input.tracks.some((t) => t.id === current.id))
      this.stop();
    if (this.wasActive !== this.input.active) {
      this.wasActive = this.input.active;
      // Lock or logout: also cancel a start still being prepared, it must not begin later.
      if (!this.input.active) {
        ++this.generation;
        this.pause();
      }
    }
  }
  dispose(): void {
    ++this.generation;
    this.audio.dispose();
  }

  // Queue
  private replaceQueue(tracks: readonly string[]): void {
    // The decoded queue omits missing tracks; never persist that partial projection.
    if (!this.input.queueReady) {
      this.patch({ error: "播放队列尚未同步，请完成同步后重试" });
      return;
    }
    this.patch({ error: "" });
    const operation = this.port.operation();
    this.queue.replace(tracks, operation);
    void this.port
      .command(contract.media.queue, { tracks: [...tracks], ...operation })
      .catch((e) => this.patch({ error: message(e, "队列更新失败") }));
  }
  enqueue = (track: string): void =>
    this.replaceQueue(withTrackLast(this.queue.tracks, track));
  enqueueAll = (tracks: readonly string[]): void => {
    const seen = new Set(this.queue.tracks);
    const added = tracks.filter((id) => !seen.has(id) && !!seen.add(id));
    if (added.length) this.replaceQueue([...this.queue.tracks, ...added]);
  };
  /** Starts `list` as the context at `track`; the user queue is kept. */
  private startContext(
    track: MediaTrack,
    list: { title: string; tracks: readonly MediaTrack[] },
  ): Promise<void> {
    this.context = openContext(
      list.title,
      list.tracks.map((t) => t.id),
      track.id,
      this.state.shuffle,
      this.random,
    );
    this.fromQueue = false;
    this.contextChanged();
    return this.start(track);
  }
  playAll = async (
    title: string,
    tracks: readonly MediaTrack[],
  ): Promise<void> => {
    const first = tracks[0];
    if (first) await this.startContext(first, { title, tracks });
  };
  private contextChanged(): void {
    this.patch({
      contextTitle: this.context?.title ?? "",
      upcoming: upcoming(this.context),
    });
  }
  setShuffle = (value: boolean): void => {
    if (this.context)
      this.context = withShuffle(this.context, value, this.random);
    this.patch({ shuffle: value });
    this.contextChanged();
  };
  setRepeat = (value: Repeat): void => this.patch({ repeat: value });
  moveUpcoming(index: number, delta: -1 | 1): void {
    if (this.context) this.context = moveUpcoming(this.context, index, delta);
    this.contextChanged();
  }
  removeUpcoming(index: number): void {
    if (this.context) this.context = removeUpcoming(this.context, index);
    this.contextChanged();
  }
  /** Plays a track of the user queue now, removing it from the queue. */
  playQueued = async (index: number): Promise<void> => {
    const track = this.trackById(this.queue.tracks[index] ?? "");
    if (!track) return;
    this.replaceQueue(withoutTrackAt(this.queue.tracks, index));
    this.fromQueue = true;
    await this.start(track);
  };
  /** Plays an upcoming context track now, skipping the ones before it. */
  playUpcoming = async (index: number): Promise<void> => {
    if (!this.context) return;
    this.context = jumpUpcoming(this.context, index);
    const track = this.trackById(
      this.context.ids[this.context.order[this.context.pos]!] ?? "",
    );
    this.fromQueue = false;
    this.contextChanged();
    if (track) await this.start(track);
  };
  playNext = (track: string): void =>
    this.replaceQueue(withTrackFirst(this.queue.tracks, track));
  moveQueued(index: number, delta: -1 | 1): void {
    this.replaceQueue(movedTrack(this.input.state?.queue ?? [], index, delta));
  }
  removeQueued(index: number): void {
    this.replaceQueue(withoutTrackAt(this.input.state?.queue ?? [], index));
  }
  clearQueue(): void {
    this.replaceQueue([]);
  }
  setStopAtEnd(value: boolean): void {
    void this.port
      .command(contract.media.stopAtEnd, {
        value,
        ...this.port.operation(),
      })
      .catch((e) => this.patch({ error: message(e, "设置失败") }));
  }
  toggleQueue = (): void => this.patch({ queueOpen: !this.state.queueOpen });
  closeQueue = (): void => this.patch({ queueOpen: false });

  // Transport
  private trackById(id: string): MediaTrack | undefined {
    return this.input.tracks.find((t) => t.id === id);
  }
  private async verified(
    bytes: Uint8Array,
    track: MediaTrack,
  ): Promise<boolean> {
    if (!track.audio || bytes.byteLength !== track.audio.size) return false;
    return (await this.transfer.sha256(copyOf(bytes))) === track.audio.id;
  }
  private applyCap(cap: number): void {
    this.patch({ maxVolume: cap });
    this.audio.setVolume(Math.min(this.state.volume, cap));
  }
  stop = (): void => {
    ++this.generation;
    this.audio.stop();
    this.patch({
      current: null,
      playing: false,
      position: 0,
      error: "",
    });
  };
  play = (
    track: MediaTrack,
    list?: { title: string; tracks: readonly MediaTrack[] },
  ): Promise<void> =>
    this.startContext(track, list ?? { title: "", tracks: [track] });
  private start = async (requested: MediaTrack): Promise<void> => {
    let track = requested;
    const { offline } = this.input;
    if (offline && !this.trackById(track.id)) {
      this.patch({ error: "没有此曲目的访问权限" });
      return;
    }
    const turn = ++this.generation;
    this.patch({ current: track, playing: false, position: 0, error: "" });
    let cap = (await this.port.getLocal<number>(CAP_KEY)) ?? 1;
    this.applyCap(cap);
    const cached = track.audio
      ? await this.port.readFile(track.audio.id)
      : undefined;
    const usable =
      cached && (await this.verified(cached, track)) ? cached : undefined;
    let bytes: Uint8Array | undefined;
    try {
      if (!offline) {
        let result = await this.port.command(contract.media.play, {
          track: track.id,
        });
        if ("queued" in result)
          throw new AppError("E_PROTOCOL", "播放请求未完成");
        cap = result.maxVolume;
        this.applyCap(cap);
        await this.port.setLocal(CAP_KEY, cap);
        if (!result.download && result.job) {
          for (let i = 0; i < 30 && turn === this.generation; i++) {
            await new Promise<void>((resolve) => this.port.delay(resolve, 500));
            result = await this.port.command(contract.media.play, {
              track: track.id,
            });
            if ("queued" in result)
              throw new AppError("E_PROTOCOL", "播放请求未完成");
            if (result.download) break;
          }
        }
        if (result.download) {
          const response = await this.transfer.fetch(result.download.url);
          if (!response.ok)
            throw new AppError(
              response.status === 401 || response.status === 403
                ? "E_DENIED"
                : "E_UNAVAILABLE",
              "音频下载失败",
            );
          const value = await response.read();
          if (!(await this.verified(value, result.track)))
            throw new AppError("E_INTEGRITY", "音频校验失败");
          bytes = value;
          track = result.track;
          this.patch({ current: track });
        }
      }
    } catch (e) {
      // A refused ticket never falls back to bytes the user may no longer be allowed to hear.
      if (
        !usable ||
        (e instanceof AppError &&
          ["E_DENIED", "E_UNAUTHENTICATED", "E_NOT_FOUND"].includes(e.code))
      ) {
        this.stop();
        this.patch({ error: message(e, "无法播放音频") });
        return;
      }
    }
    if (turn !== this.generation) return;
    bytes = bytes ?? usable;
    if (!bytes) {
      this.patch({ error: "离线未缓存或音频尚未准备好" });
      return;
    }
    if (!this.audio.ready()) return;
    this.audio.load(copyOf(bytes), track.audio?.mime ?? "audio/webm");
    this.audio.setVolume(Math.min(this.state.volume, cap));
    try {
      await this.audio.play();
      if (turn !== this.generation) {
        this.audio.pause();
        return;
      }
      this.patch({
        playing: true,
        duration: Number.isFinite(this.audio.duration)
          ? this.audio.duration
          : track.durationMs / 1000,
        error: "",
      });
      this.session.playing(track);
      try {
        await this.port.command(contract.media.recordPlay, {
          track: track.id,
          ...this.port.operation(),
        });
      } catch (error) {
        if (turn === this.generation)
          this.patch({ error: message(error, "播放记录保存失败") });
      }
    } catch (e) {
      this.patch({ error: message(e, "播放失败"), playing: false });
    }
  };
  pause = (): void => {
    this.audio.pause();
    this.patch({ playing: false });
    this.session.paused();
  };
  resume = async (): Promise<void> => {
    try {
      await this.audio.play();
      this.patch({ playing: true });
    } catch (e) {
      this.patch({ error: message(e, "播放失败") });
    }
  };
  /** Moves on to the next playable track; false when nothing follows. */
  private step = async (auto: boolean): Promise<void> => {
    const { current } = this.state;
    if (!current) return;
    let from = current.id;
    for (let tries = 0; tries < 50; tries++) {
      const step = advance(
        {
          context: this.context,
          queue: this.queue.tracks,
          repeat: this.state.repeat,
        },
        auto,
        from,
        this.random,
      );
      if (step.id === null) break;
      this.context = step.context;
      if (step.fromQueue) this.replaceQueue(step.queue);
      this.fromQueue = step.fromQueue;
      this.contextChanged();
      const track = this.trackById(step.id);
      if (track) return this.start(track);
      // A revoked or missing track is skipped.
      from = step.id;
      auto = false;
    }
    this.pause();
    this.patch({ position: 0 });
  };
  next = (): Promise<void> => this.step(false);
  previous = async (): Promise<void> => {
    const { current } = this.state;
    if (!current) return;
    const back = retreat(
      { context: this.context, repeat: this.state.repeat },
      this.fromQueue,
      this.state.position,
    );
    if (back.restart) {
      this.seek(0);
      return;
    }
    const track = this.trackById(back.id);
    if (!track) return;
    this.context = back.context;
    this.fromQueue = false;
    this.contextChanged();
    await this.start(track);
  };
  seek = (seconds: number): void => {
    if (!this.audio.ready() || !Number.isFinite(seconds)) return;
    this.patch({ position: this.audio.seek(seconds) });
  };
  setVolume = (value: number): void => {
    const next = Math.max(0, Math.min(1, value));
    this.patch({ volume: next });
    this.audio.setVolume(Math.min(next, this.state.maxVolume));
  };

  // Output events
  ended(): void {
    this.patch({ playing: false });
    if (this.input.state?.stopAtEnd) return;
    void this.step(true);
  }
  timeUpdate(seconds: number): void {
    this.patch({ position: seconds });
  }
  durationChange(seconds: number): void {
    this.patch({ duration: Number.isFinite(seconds) ? seconds : 0 });
  }
  outputFailed(): void {
    if (this.state.current) this.patch({ error: "音频播放中断" });
  }
}
