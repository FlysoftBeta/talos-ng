import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppError } from "@talos/base";
import type { CancellationSignal } from "@talos/base";
import { isMusicEntry, nextOffset } from "./music-filter.ts";

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
  live_status?: unknown;
  categories?: unknown;
  playlist_count?: unknown;
  url?: unknown;
  thumbnails?: unknown;
}
const SEARCH_FILTER = {
  playlist: "EgIQAw%253D%253D",
  artist: "EgIQAg%253D%253D",
} as const;
/** Album ids on YouTube Music are OLAK5uy_ playlists; uploaded albums are ordinary playlists. */
const ID_PATTERN = {
  playlist: /^(PL|OL|RD|UU)/,
  album: /^(OLAK5uy_|PL|OL)/,
  artist: /^UC/,
} as const;
const ALBUM_TITLE = /album|专辑|專輯|アルバム|\bEP\b|\bOST\b|원|앨범/i;
const entryList = (output: Buffer): RawEntry[] => {
  const value = JSON.parse(output.toString("utf8")) as RawEntry;
  return Array.isArray(value.entries) ? (value.entries as RawEntry[]) : [];
};
const parsed = (output: Buffer): RawEntry =>
  JSON.parse(output.toString("utf8")) as RawEntry;
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
function musicTracks(entries: RawEntry[]): ProviderTrack[] {
  return entries
    .filter(
      (e) =>
        typeof e.title === "string" &&
        isMusicEntry({
          title: e.title,
          duration: e.duration,
          liveStatus: e.live_status,
          categories: e.categories,
        }),
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
  return [kind === "album" ? "专辑" : "", ownerOf(e), count]
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
    if (!/^[\w-]{1,100}$/.test(e.id)) continue;
    // Anything that is not a playlist, album or channel id is a plain video.
    if (!ID_PATTERN[kind].test(e.id)) continue;
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
      : raw;
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
  private page(
    entries: RawEntry[],
    offset: number,
    limit: number,
    kind: SearchKind | "tracks",
    header: ProviderCollection | null = null,
  ): ProviderPage {
    return {
      tracks: kind === "song" || kind === "tracks" ? musicTracks(entries) : [],
      collections:
        kind === "song" || kind === "tracks"
          ? []
          : collectionsOf(entries, kind),
      next: nextOffset(offset, limit, entries.length),
      collection: header,
    };
  }
  private items(offset: number, limit: number, target: string): string[] {
    return [
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
    const q = encodeURIComponent(query);
    const web = (text: string, filter: string) =>
      `https://www.youtube.com/results?search_query=${text}&sp=${filter}`;
    if (kind === "song") {
      const output = await this.run(
        this.items(offset, limit, `ytsearch${offset + limit}:${query}`),
        signal,
      );
      return this.page(entryList(output), offset, limit, kind);
    }
    if (kind === "album") {
      // YouTube Music's album shelf first; some yt-dlp builds list nothing there, so fall
      // back to ordinary playlists that are named like albums.
      let entries = entryList(
        await this.run(
          this.items(
            offset,
            limit,
            `https://music.youtube.com/search?q=${q}#albums`,
          ),
          signal,
        ),
      );
      let raw = entries.length;
      if (!entries.length) {
        entries = entryList(
          await this.run(
            this.items(
              offset,
              limit,
              web(encodeURIComponent(`${query} album`), SEARCH_FILTER.playlist),
            ),
            signal,
          ),
        );
        raw = entries.length;
        entries = entries.filter(
          (e) =>
            typeof e.id === "string" &&
            (e.id.startsWith("OLAK5uy_") ||
              (typeof e.title === "string" && ALBUM_TITLE.test(e.title))),
        );
      }
      return {
        ...this.page(entries, offset, limit, kind),
        next: nextOffset(offset, limit, raw),
      };
    }
    const output = await this.run(
      this.items(offset, limit, web(q, SEARCH_FILTER[kind])),
      signal,
    );
    return this.page(entryList(output), offset, limit, kind);
  }
  /** An artist's albums: its releases tab, else its playlists (best effort, never fatal). */
  private async artistShelf(
    id: string,
    limit: number,
    signal?: CancellationSignal,
  ): Promise<ProviderCollection[]> {
    for (const [tab, kind] of [
      ["releases", "album"],
      ["playlists", "playlist"],
    ] as const) {
      try {
        const found = collectionsOf(
          entryList(
            await this.run(
              this.items(
                0,
                limit,
                `https://www.youtube.com/channel/${id}/${tab}`,
              ),
              signal,
            ),
          ),
          kind,
        );
        if (found.length) return found;
      } catch (e) {
        if (signal?.aborted) throw e;
      }
    }
    return [];
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
    if (!/^[\w-]{1,100}$/.test(id))
      throw new AppError("E_INVALID", "音乐来源无效");
    const url =
      kind === "artist"
        ? `https://www.youtube.com/channel/${id}/videos`
        : `https://www.youtube.com/playlist?list=${id}`;
    const [output, shelf] = await Promise.all([
      this.run(this.items(offset, limit, url), signal),
      // An artist page also lists albums, once, with its first page of songs.
      kind === "artist" && offset === 0
        ? this.artistShelf(id, limit, signal)
        : Promise.resolve([]),
    ]);
    const value = parsed(output);
    const entries = Array.isArray(value.entries)
      ? (value.entries as RawEntry[])
      : [];
    const page = this.page(
      entries,
      offset,
      limit,
      "tracks",
      headerOf(kind, id, value),
    );
    page.collections = shelf;
    return page;
  }
  async resolve(
    source: string,
    providerId: string,
    signal?: CancellationSignal,
  ): Promise<ProviderTrack> {
    if (source !== "youtube-music" || !/^[\w-]{1,100}$/.test(providerId))
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
