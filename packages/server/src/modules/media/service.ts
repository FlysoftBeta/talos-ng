import type { CancellationSignal } from "@talos/base";
import {
  mediaTrackSchema,
  mediaPlaylistSchema,
  mediaUserStateSchema,
} from "@talos/contract";
import { AppError, compareStamp, createUlid } from "@talos/base";
import type {
  MediaTrack,
  MediaPlaylist,
  MediaUserState,
} from "@talos/contract";
import type { Db } from "../../kernel/persistence/db.ts";
import { migrate } from "../../kernel/persistence/db.ts";
import type { Uow } from "../../kernel/persistence/uow.ts";
import type { JobCommands } from "../../kernel/jobs/ports.ts";
import type { ObjectLedger } from "../../kernel/objects/objects.ts";
import type { ObjectStore } from "@talos/objectstore";
import {
  AUDIO_CACHE_EXPIRY_MS,
  UNREFERENCED_SONG_GRACE_MS,
} from "./retention-policy.ts";
import { reconcileTracks, reclaimTracks } from "./lifecycle.ts";
import { MediaRepo } from "./repo.ts";
import { mediaMigrations } from "./schema.ts";
import type { MediaProvider, ProviderTrack } from "./provider.ts";
export interface MediaOptions {
  assertOwnerWritable?(user: string): void;
  db: Db;
  uow: Uow;
  jobs: JobCommands;
  objects: ObjectLedger;
  store: ObjectStore;
  provider: MediaProvider;
  now?: () => number;
  id?: () => string;
}
type Stamp = { t: { ms: number; counter: number }; op: string };
const newer = (a: Stamp, b: Stamp | null): boolean =>
  !b ||
  compareStamp(a.t, b.t) > 0 ||
  (compareStamp(a.t, b.t) === 0 && a.op > b.op);
export class MediaService {
  readonly repo: MediaRepo;
  private readonly now: () => number;
  private readonly id: () => string;
  constructor(readonly options: MediaOptions) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? createUlid({ clock: this.now });
    migrate(options.db, "media", mediaMigrations, this.now);
    this.repo = new MediaRepo(options.db);
    options.jobs.register("media.materialise", {
      concurrency: 2,
      timeoutMs: 20 * 60_000,
      onBoot: "requeue",
      retryable: true,
      run: async (ctx) => {
        const { track: id, generation } = ctx.payload as {
          track: string;
          generation: number;
        };
        const currentTrack = (): MediaTrack => {
          const value = this.track(id);
          if (this.repo.track(id)?.generation !== generation)
            throw new AppError("E_CANCELLED", "曲目已被回收，请重新播放");
          return value;
        };
        const track = currentTrack();
        if (track.audio) return { track: id };
        const source = await options.provider.resolve(
          track.source,
          track.providerId,
          ctx.signal,
        );
        const value = await options.provider.materialise(source, ctx.signal);
        if (value.bytes.length > 64 * 1024 * 1024)
          throw new AppError("E_TOO_LARGE", "音频超过 64 MiB");
        await options.objects.publish(
          () => options.store.put(value.bytes),
          (info) => {
            const current = currentTrack();
            if (current.audio) return;
            options.objects.addRef(info.id, "media.audio", id);
            const updated: MediaTrack = {
              ...current,
              audio: { ...info, mime: value.mime },
            };
            this.repo.putTrack(
              updated,
              options.uow.current!.rev,
              this.repo.track(id)?.last_played ?? 0,
            );
            this.changedTrack(id);
          },
        );
        return { track: id };
      },
    });
  }
  private changedTrack(id: string): void {
    const ctx = this.options.uow.current!;
    for (const user of this.repo.discoverers(id))
      ctx.changed(`me:${user.user_id}`, "mediaTrack", id);
    for (const p of this.repo.playlists())
      if ((JSON.parse(p.body) as MediaPlaylist).tracks.includes(id))
        ctx.changed(`coll:${p.id}`, "mediaTrack", id);
  }
  /** Trusted migration seam: preserves IDs/times and uses normal revision/scopes. */
  importTrack(
    value: MediaTrack,
    lastPlayed = this.repo.track(value.id)?.last_played ?? 0,
    playlist?: string,
  ): void {
    if (!mediaTrackSchema.safeParse(value).success)
      throw new AppError("E_INVALID", "Invalid imported track");
    this.options.uow.write((ctx) => {
      this.repo.putTrack(value, ctx.rev, lastPlayed);
      if (playlist) {
        const target = this.playlist(playlist);
        this.updatePlaylist(playlist, {
          tracks: [...new Set([...target.tracks, value.id])],
        });
      }
      reconcileTracks(this.repo, [value.id], ctx, this.now());
      if (value.audio)
        this.options.objects.addRef(value.audio.id, "media.audio", value.id);
      this.changedTrack(value.id);
    });
  }
  importPlaylist(value: MediaPlaylist): void {
    if (!mediaPlaylistSchema.safeParse(value).success)
      throw new AppError("E_INVALID", "Invalid imported playlist");
    this.options.uow.write((ctx) => {
      value.tracks.forEach((id) => this.track(id));
      const before = this.repo.playlist(value.id);
      this.repo.putPlaylist(value, ctx.rev);
      reconcileTracks(
        this.repo,
        [
          ...(before ? (JSON.parse(before.body) as MediaPlaylist).tracks : []),
          ...value.tracks,
        ],
        ctx,
        this.now(),
      );
      ctx.changed(`me:${value.owner}`, "mediaPlaylist", value.id);
      ctx.changed(`coll:${value.id}`, "mediaPlaylist", value.id);
    });
  }
  importState(user: string, value: MediaUserState): void {
    if (!mediaUserStateSchema.safeParse(value).success)
      throw new AppError("E_INVALID", "Invalid imported media state");
    this.save(user, value);
  }
  track(id: string): MediaTrack {
    const row = this.repo.track(id);
    if (!row || row.deleted) throw new AppError("E_NOT_FOUND", "曲目不存在");
    return JSON.parse(row.body) as MediaTrack;
  }
  playlist(id: string): MediaPlaylist {
    const row = this.repo.playlist(id);
    if (!row || row.deleted) throw new AppError("E_NOT_FOUND", "歌单不存在");
    return JSON.parse(row.body) as MediaPlaylist;
  }
  state(user: string): MediaUserState {
    const row = this.repo.state(user);
    return row
      ? (JSON.parse(row.body) as MediaUserState)
      : {
          id: user,
          favorites: {},
          queue: [],
          queueStamp: null,
          recents: [],
          stopAtEnd: false,
          stopStamp: null,
        };
  }
  private save(user: string, value: MediaUserState): void {
    this.options.uow.write((ctx) => {
      this.repo.putState(user, value, ctx.rev);
      ctx.changed(`me:${user}`, "mediaUserState", user);
    });
  }
  async search(
    query: string,
    limit: number,
    user: string,
    signal?: CancellationSignal,
  ): Promise<MediaTrack[]> {
    const values = await this.options.provider.search(query, limit, signal);
    return this.ingest(values.slice(0, limit), user);
  }
  /** Trusted provider ingestion; public resolve only reads a currently accessible track. */
  async resolve(
    source: string,
    providerId: string,
    user: string,
    signal?: CancellationSignal,
  ): Promise<MediaTrack> {
    const value = await this.options.provider.resolve(
      source,
      providerId,
      signal,
    );
    return this.ingest([value], user)[0]!;
  }
  private ingest(values: readonly ProviderTrack[], user: string): MediaTrack[] {
    this.options.assertOwnerWritable?.(user);
    return this.options.uow.write((ctx) => {
      if (!values.length) return [];
      const tracks = values.map((value) => this.ensure(value));
      for (const track of tracks) {
        this.repo.discover(user, track.id, ctx.rev);
        ctx.changed(`me:${user}`, "mediaTrack", track.id);
      }
      return tracks;
    });
  }
  private ensure(value: ProviderTrack): MediaTrack {
    const found = this.repo.source(value.source, value.providerId);
    if (found && !found.deleted) return JSON.parse(found.body) as MediaTrack;
    const track: MediaTrack = {
      id: found?.id ?? this.id(),
      source: value.source,
      providerId: value.providerId,
      title: value.title,
      artists: value.artists,
      album: value.album,
      durationMs: value.durationMs,
      audio: null,
    };
    this.options.uow.write((ctx) => {
      this.repo.putTrack(track, ctx.rev);
      reconcileTracks(this.repo, [track.id], ctx, this.now());
      this.changedTrack(track.id);
    });
    return track;
  }
  play(user: string, id: string): { track: MediaTrack; job: string | null } {
    const track = this.track(id),
      state = this.state(user);
    this.options.uow.write((ctx) => {
      this.repo.putState(
        user,
        {
          ...state,
          recents: [id, ...state.recents.filter((v) => v !== id)].slice(0, 12),
        },
        ctx.rev,
      );
      this.repo.putTrack(track, ctx.rev, this.now());
      ctx.changed(`me:${user}`, "mediaUserState", user);
      this.changedTrack(id);
    });
    return this.prepare(user, id);
  }
  prepare(user: string, id: string): { track: MediaTrack; job: string | null } {
    const track = this.track(id);
    if (track.audio) return { track, job: null };
    return this.options.uow.write(() => {
      const generation = this.repo.track(id)!.generation!;
      const existing = this.options.jobs
        .activeJobs("media.materialise")
        .find((job) => {
          const payload = job.payload as {
            track?: string;
            generation?: number;
          } | null;
          return payload?.track === id && payload.generation === generation;
        });
      return {
        track,
        job:
          existing?.id ??
          this.options.jobs.enqueue(user, "media.materialise", {
            track: id,
            generation,
          }).id,
      };
    });
  }

  favorite(
    user: string,
    track: string,
    value: { v: boolean; t: Stamp["t"]; op: string },
  ): void {
    this.track(track);
    const state = this.state(user);
    if (newer(value, state.favorites[track] ?? null))
      this.save(user, {
        ...state,
        favorites: { ...state.favorites, [track]: value },
      });
  }
  queue(user: string, tracks: string[], value: Stamp): void {
    if (new Set(tracks).size !== tracks.length)
      throw new AppError("E_INVALID", "队列不能包含重复曲目");
    tracks.forEach((id) => this.track(id));
    const state = this.state(user);
    if (newer(value, state.queueStamp))
      this.save(user, {
        ...state,
        queue: tracks,
        queueStamp: { t: value.t, op: value.op },
      });
  }
  setStopAtEnd(user: string, stopAtEnd: boolean, value: Stamp): void {
    const state = this.state(user);
    if (newer(value, state.stopStamp))
      this.save(user, {
        ...state,
        stopAtEnd,
        stopStamp: { t: value.t, op: value.op },
      });
  }
  createPlaylist(user: string, title: string): MediaPlaylist {
    const value: MediaPlaylist = {
      id: this.id(),
      owner: user,
      title,
      tracks: [],
      retentionDays: 7,
      lastPlayed: 0,
      created: this.now(),
    };
    this.options.uow.write((ctx) => {
      this.repo.putPlaylist(value, ctx.rev);
      ctx.changed(`me:${user}`, "mediaPlaylist", value.id);
      ctx.changed(`coll:${value.id}`, "mediaPlaylist", value.id);
    });
    return value;
  }
  updatePlaylist(
    id: string,
    patch: Partial<
      Pick<MediaPlaylist, "tracks" | "retentionDays" | "lastPlayed">
    >,
  ): MediaPlaylist {
    const before = this.playlist(id);
    if (patch.tracks) {
      if (patch.tracks.length > 500)
        throw new AppError("E_TOO_LARGE", "歌单最多 500 首");
      if (new Set(patch.tracks).size !== patch.tracks.length)
        throw new AppError("E_INVALID", "歌单不能包含重复曲目");
      patch.tracks.forEach((track) => this.track(track));
    }
    const value = { ...before, ...patch };
    this.options.uow.write((ctx) => {
      this.repo.putPlaylist(value, ctx.rev);
      reconcileTracks(
        this.repo,
        [...before.tracks, ...value.tracks],
        ctx,
        this.now(),
      );
      ctx.changed(`me:${value.owner}`, "mediaPlaylist", id);
      ctx.changed(`coll:${id}`, "mediaPlaylist", id);
      for (const track of new Set([...before.tracks, ...value.tracks]))
        ctx.changed(`coll:${id}`, "mediaTrack", track);
    });
    return value;
  }
  deletePlaylist(id: string): void {
    const value = this.playlist(id);
    this.options.uow.write((ctx) => {
      this.repo.putPlaylist(value, ctx.rev, true);
      reconcileTracks(this.repo, value.tracks, ctx, this.now());
      for (const track of value.tracks)
        ctx.changed(`coll:${id}`, "mediaTrack", track);
      ctx.changed(`me:${value.owner}`, "mediaPlaylist", id);
      ctx.changed(`coll:${id}`, "mediaPlaylist", id);
    });
  }
  evict(): number {
    const now = this.now();
    const songCutoff = now - UNREFERENCED_SONG_GRACE_MS;
    const audioCutoff = now - AUDIO_CACHE_EXPIRY_MS;
    let count = 0;
    // Bound each reclamation revision so a large backlog remains synchronisable.
    for (;;) {
      const reclaimed = this.options.uow.write((ctx) =>
        reclaimTracks(this.repo, this.options.objects, songCutoff, ctx),
      );
      count += reclaimed;
      if (reclaimed < 100) break;
    }
    this.options.uow.write(() => {
      for (const row of this.repo.tracks()) {
        const track = JSON.parse(row.body) as MediaTrack;
        if (!track.audio || (row.last_played ?? 0) > audioCutoff) continue;
        this.options.objects.removeRef(track.audio.id, "media.audio", track.id);
        this.repo.putTrack(
          { ...track, audio: null },
          this.options.uow.current!.rev,
          row.last_played,
        );
        this.changedTrack(track.id);
        count++;
      }
    });
    return count;
  }
}
