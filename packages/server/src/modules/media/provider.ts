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
export interface MediaProvider {
  search(
    query: string,
    limit: number,
    signal?: CancellationSignal,
  ): Promise<ProviderTrack[]>;
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
const execute = promisify(execFile);
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
  constructor(readonly binaryPath: string) {}
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
      const { stdout } = await execute(
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
  async search(
    query: string,
    limit: number,
    signal?: CancellationSignal,
  ): Promise<ProviderTrack[]> {
    const output = await this.run(
      [
        "--flat-playlist",
        "--dump-single-json",
        "--playlist-items",
        `1-${limit}`,
        `ytsearch${limit}:${query}`,
      ],
      signal,
    );
    const value = JSON.parse(output.toString("utf8")) as RawEntry;
    return (Array.isArray(value.entries) ? value.entries : [])
      .map((v) => parse(v as RawEntry))
      .filter((v): v is ProviderTrack => !!v)
      .slice(0, limit);
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
  async search(query: string, limit: number): Promise<ProviderTrack[]> {
    return [...this.values.values()]
      .filter((v) =>
        `${v.track.title} ${v.track.artists.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
      .slice(0, limit)
      .map((v) => v.track);
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
