import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppError } from "@talos/base";
import type { CancellationSignal } from "@talos/base";

export interface ProviderTrack {
  source: string;
  providerId: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number;
  url: string;
}
export type CollectionKind = "playlist" | "artist" | "album";
export type SearchKind = "song" | CollectionKind;
export interface ProviderCollection {
  kind: CollectionKind;
  id: string;
  title: string;
  subtitle: string;
  /** An https cover or avatar url, null when the listing has none. */
  thumbnail: string | null;
}
/** One page of provider results; `next` is the offset of the following page, null at the end. */
export interface ProviderPage {
  tracks: ProviderTrack[];
  collections: ProviderCollection[];
  next: number | null;
  /** The opened playlist, album or artist itself; null for search pages. */
  collection: ProviderCollection | null;
}
export interface MediaProvider {
  search(
    input: { query: string; kind: SearchKind; offset: number; limit: number },
    signal?: CancellationSignal,
  ): Promise<ProviderPage>;
  /** The music tracks of a playlist or an artist, paged. */
  collection(
    input: {
      kind: CollectionKind;
      id: string;
      offset: number;
      limit: number;
    },
    signal?: CancellationSignal,
  ): Promise<ProviderPage>;
  resolve(
    source: string,
    providerId: string,
    signal?: CancellationSignal,
  ): Promise<ProviderTrack>;
  materialise(
    track: ProviderTrack,
    signal?: CancellationSignal,
  ): Promise<{ bytes: Uint8Array; mime: string }>;
}
/** Runs the yt-dlp binary and resolves with its raw stdout. */
export type Spawn = (
  file: string,
  args: string[],
  options: {
    timeout: number;
    maxBuffer: number;
    encoding: "buffer";
    signal: AbortSignal;
    windowsHide: boolean;
  },
) => Promise<{ stdout: Buffer }>;
const execute: Spawn = promisify(execFile) as unknown as Spawn;
interface RawEntry {
  id?: unknown;
  title?: unknown;
  artist?: unknown;
  channel?: unknown;
  uploader?: unknown;
  artists?: unknown;
  album?: unknown;
  duration?: unknown;
  webpage_url?: unknown;
  entries?: unknown;
  playlist_count?: unknown;
  release_year?: unknown;
  url?: unknown;
  thumbnails?: unknown;
  /** Set by the bundled yt-dlp plugin: song, album, artist or playlist. */
  talos_kind?: unknown;
  talos_albums?: unknown;
  talos_songs_playlist?: unknown;
}
/**
 * The YouTube Music search section each kind comes from. Every section is a
 * catalogue result list, so nothing needs filtering afterwards.
 */
const SECTION = {
  song: "songs",
  album: "albums",
  artist: "artists",
  playlist: "playlists",
} as const;
const ID_PATTERN = {
  playlist: /^(PL|OL|RD|UU)/,
  /** Album ids on YouTube Music are OLAK5uy_ playlists. */
  album: /^OLAK5uy_/,
  artist: /^UC/,
} as const;
/** Placeholders YouTube leaves in playlists for removed uploads. */
const UNAVAILABLE_TITLE = /^\[(private|deleted) video\]$/i;
const SAFE_ID = /^[\w-]{1,100}$/;
const entryList = (output: Buffer): RawEntry[] => {
  const value = JSON.parse(output.toString("utf8")) as RawEntry;
  return Array.isArray(value.entries) ? (value.entries as RawEntry[]) : [];
};
const parsed = (output: Buffer): RawEntry =>
  JSON.parse(output.toString("utf8")) as RawEntry;
/** The next offset of a raw page: null once the provider returned fewer entries than asked. */
const nextOffset = (offset: number, limit: number, rawCount: number) =>
  rawCount >= limit ? offset + limit : null;
/** The smallest https image at least 300 px wide, else the widest one. */
function thumbnailOf(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const images = value
    .filter(
      (v): v is { url: string; width?: unknown } =>
        !!v && typeof v === "object" && typeof (v as RawEntry).url === "string",
    )
    .filter((v) => v.url.startsWith("https://"))
    .map((v) => ({
      url: v.url,
      width: typeof v.width === "number" ? v.width : 0,
    }));
  const big = images
    .filter((v) => v.width >= 300)
    .sort((a, b) => a.width - b.width);
  return (
    big[0]?.url ?? images.sort((a, b) => b.width - a.width)[0]?.url ?? null
  );
}
function tracksOf(entries: RawEntry[]): ProviderTrack[] {
  return entries
    .filter(
      (e) => typeof e.title !== "string" || !UNAVAILABLE_TITLE.test(e.title),
    )
    .map(parse)
    .filter((v): v is ProviderTrack => !!v);
}
const ownerOf = (e: RawEntry): string =>
  typeof e.channel === "string"
    ? e.channel
    : typeof e.uploader === "string"
      ? e.uploader
      : "";
function subtitleOf(kind: CollectionKind, e: RawEntry): string {
  if (kind === "artist") return "歌手";
  const count =
    typeof e.playlist_count === "number" ? `${e.playlist_count} 首` : "";
  const year = typeof e.release_year === "number" ? `${e.release_year}` : "";
  return [kind === "album" ? "专辑" : "", ownerOf(e), year, count]
    .filter(Boolean)
    .join(" · ");
}
function collectionsOf(
  entries: RawEntry[],
  kind: CollectionKind,
): ProviderCollection[] {
  const out: ProviderCollection[] = [];
  for (const e of entries) {
    if (typeof e.id !== "string" || typeof e.title !== "string") continue;
    if (!SAFE_ID.test(e.id) || !ID_PATTERN[kind].test(e.id)) continue;
    out.push({
      kind,
      id: e.id,
      title: e.title,
      subtitle: subtitleOf(kind, e),
      thumbnail: thumbnailOf(e.thumbnails),
    });
  }
  return out;
}
/** The header of an opened collection from the top level of its yt-dlp output. */
function headerOf(
  kind: CollectionKind,
  id: string,
  value: RawEntry,
): ProviderCollection {
  const raw = typeof value.title === "string" ? value.title : "";
  const title =
    kind === "artist"
      ? ownerOf(value) || raw.replace(/ - (Videos|视频|影片)$/, "")
      : raw.replace(/^(Album|专辑|專輯) - /, "");
  return {
    kind,
    id,
    title: title || id,
    subtitle: subtitleOf(kind, value),
    thumbnail: thumbnailOf(value.thumbnails),
  };
}
function parse(raw: RawEntry): ProviderTrack | null {
  if (typeof raw.id !== "string" || typeof raw.title !== "string") return null;
  const names = Array.isArray(raw.artists)
    ? raw.artists.filter((v): v is string => typeof v === "string")
    : [];
  return {
    source: "youtube-music",
    providerId: raw.id,
    title: raw.title,
    artists: names.length
      ? names
      : typeof raw.artist === "string"
        ? [raw.artist]
        : typeof raw.channel === "string"
          ? [raw.channel]
          : typeof raw.uploader === "string"
            ? [raw.uploader]
            : [],
    album: typeof raw.album === "string" ? raw.album : null,
    durationMs:
      typeof raw.duration === "number" && raw.duration >= 0
        ? Math.round(raw.duration * 1000)
        : 0,
    url:
      typeof raw.webpage_url === "string"
        ? raw.webpage_url
        : `https://music.youtube.com/watch?v=${encodeURIComponent(raw.id)}`,
  };
}
/** All subprocess work is bounded. The service runs materialisation in a durable job. */
export class YtDlpProvider implements MediaProvider {
  constructor(
    readonly binaryPath: string,
    /** The subprocess runner; tests replace it with recorded yt-dlp output. */
    private readonly spawn: Spawn = execute,
    /**
     * The directory holding the bundled `talos-music` yt-dlp plugin (search
     * sections and artist pages). Without it only plain playlists open.
     */
    private readonly pluginDir: string | null = null,
  ) {}
  private async run(
    args: string[],
    signal?: CancellationSignal,
  ): Promise<Buffer> {
    if (!this.binaryPath) throw new AppError("E_UNAVAILABLE", "yt-dlp 未配置");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const { stdout } = await this.spawn(
        this.binaryPath,
        ["--no-warnings", ...args],
        {
          timeout: 120_000,
          maxBuffer: 64 * 1024 * 1024,
          encoding: "buffer",
          signal: controller.signal,
          windowsHide: true,
        },
      );
      return stdout;
    } catch (cause) {
      throw new AppError(
        signal?.aborted ? "E_CANCELLED" : "E_UNAVAILABLE",
        signal?.aborted ? "音乐任务已取消" : "音乐来源暂时不可用",
        { cause: String(cause) },
      );
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  /** A flat, paged listing of `target`; plugin extractors need the plugin directory. */
  private items(offset: number, limit: number, target: string): string[] {
    return [
      ...(this.pluginDir ? ["--plugin-dirs", this.pluginDir] : []),
      "--flat-playlist",
      "--dump-single-json",
      "--playlist-items",
      `${offset + 1}-${offset + limit}`,
      target,
    ];
  }
  async search(
    input: { query: string; kind: SearchKind; offset: number; limit: number },
    signal?: CancellationSignal,
  ): Promise<ProviderPage> {
    const { query, kind, offset, limit } = input;
    if (!this.pluginDir)
      throw new AppError("E_UNAVAILABLE", "音乐搜索组件未安装");
    // One YouTube Music catalogue section per kind: no video search, no
    // after-the-fact guessing whether a hit is music.
    const output = await this.run(
      this.items(
        offset,
        limit,
        `https://music.youtube.com/search?q=${encodeURIComponent(query)}#${SECTION[kind]}`,
      ),
      signal,
    );
    const entries = entryList(output);
    const next = nextOffset(offset, limit, entries.length);
    if (kind === "song")
      return {
        tracks: tracksOf(entries.filter((e) => e.talos_kind === "song")),
        collections: [],
        next,
        collection: null,
      };
    return {
      tracks: [],
      collections: collectionsOf(
        entries.filter((e) => e.talos_kind === kind),
        kind,
      ),
      next,
      collection: null,
    };
  }
  /** An artist page: header, albums (first page only) and a page of songs. */
  private async artist(
    id: string,
    offset: number,
    limit: number,
    signal?: CancellationSignal,
  ): Promise<ProviderPage> {
    if (!this.pluginDir)
      throw new AppError("E_UNAVAILABLE", "音乐搜索组件未安装");
    const value = parsed(
      await this.run(
        [
          "--plugin-dirs",
          this.pluginDir,
          "--flat-playlist",
          "--dump-single-json",
          `talos-music:artist:${id}`,
        ],
        signal,
      ),
    );
    const shelf = Array.isArray(value.entries)
      ? (value.entries as RawEntry[])
      : [];
    const songsList =
      typeof value.talos_songs_playlist === "string" &&
      SAFE_ID.test(value.talos_songs_playlist)
        ? value.talos_songs_playlist
        : null;
    // The shelf shows only the first few songs; its "see all" playlist pages
    // the rest. Without one, the shelf is the whole list.
    const songs = songsList
      ? entryList(
          await this.run(
            this.items(
              offset,
              limit,
              `https://music.youtube.com/playlist?list=${songsList}`,
            ),
            signal,
          ),
        )
      : shelf.slice(offset, offset + limit);
    const total = songsList ? songs.length : shelf.length - offset;
    return {
      tracks: tracksOf(songs),
      collections:
        offset === 0
          ? collectionsOf(
              Array.isArray(value.talos_albums)
                ? (value.talos_albums as RawEntry[])
                : [],
              "album",
            )
          : [],
      next: songsList
        ? nextOffset(offset, limit, total)
        : shelf.length > offset + limit
          ? offset + limit
          : null,
      collection: headerOf("artist", id, value),
    };
  }
  async collection(
    input: {
      kind: CollectionKind;
      id: string;
      offset: number;
      limit: number;
    },
    signal?: CancellationSignal,
  ): Promise<ProviderPage> {
    const { kind, id, offset, limit } = input;
    if (!SAFE_ID.test(id)) throw new AppError("E_INVALID", "音乐来源无效");
    if (kind === "artist") return this.artist(id, offset, limit, signal);
    // Playlists and albums (OLAK5uy_ playlists) open as music playlists; every
    // item is listed, whatever its length.
    const value = parsed(
      await this.run(
        this.items(
          offset,
          limit,
          `https://music.youtube.com/playlist?list=${id}`,
        ),
        signal,
      ),
    );
    const entries = Array.isArray(value.entries)
      ? (value.entries as RawEntry[])
      : [];
    return {
      tracks: tracksOf(entries),
      collections: [],
      next: nextOffset(offset, limit, entries.length),
      collection: headerOf(kind, id, value),
    };
  }
  async resolve(
    source: string,
    providerId: string,
    signal?: CancellationSignal,
  ): Promise<ProviderTrack> {
    if (source !== "youtube-music" || !SAFE_ID.test(providerId))
      throw new AppError("E_INVALID", "音乐来源无效");
    const output = await this.run(
      [
        "--dump-single-json",
        "--skip-download",
        `https://music.youtube.com/watch?v=${encodeURIComponent(providerId)}`,
      ],
      signal,
    );
    const value = parse(JSON.parse(output.toString("utf8")) as RawEntry);
    if (!value) throw new AppError("E_NOT_FOUND", "没有找到曲目");
    return value;
  }
  async materialise(
    track: ProviderTrack,
    signal?: CancellationSignal,
  ): Promise<{ bytes: Uint8Array; mime: string }> {
    const bytes = await this.run(
      [
        "--format",
        "bestaudio[ext=webm][acodec=opus]/bestaudio[ext=webm]",
        "--no-playlist",
        "--output",
        "-",
        track.url,
      ],
      signal,
    );
    if (!bytes.length) throw new AppError("E_UNAVAILABLE", "音频内容为空");
    return { bytes: new Uint8Array(bytes), mime: "audio/webm" };
  }
}
/** An in-memory provider with stable results and real audio bytes for integration tests. */
export class FakeMediaProvider implements MediaProvider {
  private readonly values = new Map<
    string,
    { track: ProviderTrack; bytes: Uint8Array; mime: string }
  >();
  add(track: ProviderTrack, bytes: Uint8Array, mime = "audio/wav"): void {
    this.values.set(`${track.source}:${track.providerId}`, {
      track,
      bytes,
      mime,
    });
  }
  async search(input: {
    query: string;
    kind: SearchKind;
    offset: number;
    limit: number;
  }): Promise<ProviderPage> {
    const q = input.query.toLowerCase();
    const all = [...this.values.values()].map((v) => v.track);
    if (input.kind !== "song")
      return {
        tracks: [],
        collections:
          all.length && q
            ? [
                input.kind === "playlist"
                  ? {
                      kind: "playlist",
                      id: "fake-list",
                      title: "练习曲合集",
                      subtitle: `${all.length} 首`,
                      thumbnail: null,
                    }
                  : {
                      kind: "artist",
                      id: "fake-artist",
                      title: "Talos 测试音频",
                      subtitle: "歌手",
                      thumbnail: null,
                    },
              ]
            : [],
        next: null,
        collection: null,
      };
    const hits = all.filter((t) =>
      `${t.title} ${t.artists.join(" ")}`.toLowerCase().includes(q),
    );
    const tracks = hits.slice(input.offset, input.offset + input.limit);
    return {
      tracks,
      collections: [],
      next:
        input.offset + input.limit < hits.length
          ? input.offset + input.limit
          : null,
      collection: null,
    };
  }
  async collection(input: {
    kind: CollectionKind;
    id: string;
    offset: number;
    limit: number;
  }): Promise<ProviderPage> {
    if (!input.id.startsWith("fake-"))
      throw new AppError("E_NOT_FOUND", "没有找到曲目");
    const all = [...this.values.values()].map((v) => v.track);
    const tracks = all.slice(input.offset, input.offset + input.limit);
    return {
      tracks,
      collections:
        input.kind === "artist" && input.offset === 0
          ? [
              {
                kind: "album",
                id: "fake-album",
                title: "练习曲专辑",
                subtitle: "专辑",
                thumbnail: null,
              },
            ]
          : [],
      next:
        input.offset + input.limit < all.length
          ? input.offset + input.limit
          : null,
      collection: {
        kind: input.kind,
        id: input.id,
        title: input.kind === "artist" ? "Talos 测试音频" : "练习曲合集",
        subtitle: input.kind === "artist" ? "歌手" : `${all.length} 首`,
        thumbnail: null,
      },
    };
  }
  async resolve(source: string, providerId: string): Promise<ProviderTrack> {
    const value = this.values.get(`${source}:${providerId}`);
    if (!value) throw new AppError("E_NOT_FOUND", "没有找到曲目");
    return value.track;
  }
  async materialise(
    track: ProviderTrack,
  ): Promise<{ bytes: Uint8Array; mime: string }> {
    const value = this.values.get(`${track.source}:${track.providerId}`);
    if (!value) throw new AppError("E_NOT_FOUND", "没有找到曲目");
    return { bytes: value.bytes.slice(), mime: value.mime };
  }
}
export function testMediaProvider(): FakeMediaProvider {
  const provider = new FakeMediaProvider();
  const bytes = new Uint8Array(44 + 120000);
  const view = new DataView(bytes.buffer);
  for (const [text, start] of [
    ["RIFF", 0],
    ["WAVE", 8],
    ["fmt ", 12],
    ["data", 36],
  ] as const)
    for (let i = 0; i < 4; i++) bytes[start + i] = text.charCodeAt(i);
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  view.setUint32(40, 120000, true);
  bytes.fill(128, 44);
  for (const [providerId, title] of [
    ["test-one", "晨光练习曲"],
    ["test-two", "夜色练习曲"],
    ["test-three", "雨后练习曲"],
  ] as const)
    provider.add(
      {
        source: "fake",
        providerId,
        title,
        artists: ["Talos 测试音频"],
        album: "离线播放测试",
        durationMs: 15000,
        url: `fake://${providerId}`,
      },
      bytes,
    );
  return provider;
}
