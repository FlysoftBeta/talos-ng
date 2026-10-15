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
  withTrackLast,
  withoutTrackAt,
} from "./queue.ts";

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
}
export interface PlayerApi extends PlaybackState {
  play(track: MediaTrack): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  stop(): void;
  seek(seconds: number): void;
  setVolume(value: number): void;
  toggleQueue(): void;
  enqueue(track: string): void;
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
  };
  constructor(
    private readonly port: PlaybackPort,
    private readonly audio: AudioPort,
    private readonly transfer: AudioTransfer,
    private readonly session: MediaSessionPort,
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
    const operation = this.port.operation();
    this.queue.replace(tracks, operation);
    void this.port
      .command(contract.media.queue, { tracks: [...tracks], ...operation })
      .catch((e) => this.patch({ error: message(e, "队列更新失败") }));
  }
  enqueue = (track: string): void =>
    this.replaceQueue(withTrackLast(this.queue.tracks, track));
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
  play = async (requested: MediaTrack): Promise<void> => {
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
  private adjacent = async (delta: number): Promise<void> => {
    const { current } = this.state;
    if (!current) return;
    const id = this.queue.neighbour(current.id, delta);
    const track = id ? this.trackById(id) : undefined;
    if (track) await this.play(track);
    else if (delta > 0) {
      this.pause();
      this.patch({ position: 0 });
    }
  };
  next = (): Promise<void> => this.adjacent(1);
  previous = (): Promise<void> => this.adjacent(-1);
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
    void this.next();
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
