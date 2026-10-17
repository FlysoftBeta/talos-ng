// YtDlpProvider end to end against recorded yt-dlp 2026.08.19 `--flat-playlist
// --dump-single-json` output (fixtures/), with the subprocess replaced by a fake.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { YtDlpProvider } from "./provider.ts";
import type { Spawn } from "./provider.ts";

const fixture = (
  name: string,
): Record<string, unknown> & { entries: Record<string, unknown>[] } =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  );
/** A provider answering every yt-dlp call with `output`, recording the argv. */
function fake(output: unknown) {
  const calls: string[][] = [];
  const spawn: Spawn = async (_file, args) => {
    calls.push(args);
    return { stdout: Buffer.from(JSON.stringify(output)) };
  };
  return { provider: new YtDlpProvider("yt-dlp", spawn), calls };
}
/** Answers by the url argument, like yt-dlp would; unknown urls fail like a missing tab. */
function routed(outputs: Record<string, unknown>) {
  const calls: string[][] = [];
  const spawn: Spawn = async (_file, args) => {
    calls.push(args);
    const hit = Object.entries(outputs).find(([key]) =>
      args.at(-1)!.includes(key),
    );
    if (!hit) throw new Error("ERROR: This channel does not have that tab");
    return { stdout: Buffer.from(JSON.stringify(hit[1])) };
  };
  return { provider: new YtDlpProvider("yt-dlp", spawn), calls };
}
const noDurations = (name: string) => {
  const v = fixture(name);
  return {
    ...v,
    entries: v.entries.map((e) => ({ ...e, duration: null })),
  };
};

describe("yt-dlp provider song search", () => {
  it("asks for the first page and keeps every recorded song", async () => {
    const { provider, calls } = fake(fixture("search-songs-page1"));
    const page = await provider.search({
      query: "周杰伦 晴天",
      kind: "song",
      offset: 0,
      limit: 5,
    });
    expect(calls[0]).toEqual([
      "--no-warnings",
      "--flat-playlist",
      "--dump-single-json",
      "--playlist-items",
      "1-5",
      "ytsearch5:周杰伦 晴天",
    ]);
    expect(page.tracks.map((t) => t.providerId)).toEqual([
      "DYptgVvkVLQ",
      "3-DteAHyRnI",
      "k35UurSJPEo",
      "JKPVRyg01gg",
      "y6uTqg0XjGc",
    ]);
    expect(page.tracks[0]).toMatchObject({
      source: "youtube-music",
      artists: ["周杰倫 Jay Chou"],
      durationMs: 319000,
      url: "https://music.youtube.com/watch?v=DYptgVvkVLQ",
    });
    expect(page.collections).toEqual([]);
    expect(page.next).toBe(5);
  });
  it("searches ahead of the offset and slices the second page", async () => {
    const { provider, calls } = fake(fixture("search-songs-page2"));
    const page = await provider.search({
      query: "周杰伦 晴天",
      kind: "song",
      offset: 5,
      limit: 5,
    });
    expect(calls[0]!.slice(-3)).toEqual([
      "--playlist-items",
      "6-10",
      "ytsearch10:周杰伦 晴天",
    ]);
    expect(page.tracks).toHaveLength(5);
    expect(page.next).toBe(10);
  });
  it("still lists songs when the flat listing reports no duration", async () => {
    const { provider } = fake(noDurations("search-songs-page1"));
    const page = await provider.search({
      query: "x",
      kind: "song",
      offset: 0,
      limit: 5,
    });
    expect(page.tracks).toHaveLength(5);
    expect(page.tracks[0]!.durationMs).toBe(0);
  });
  it("ends paging when the provider returns a short page", async () => {
    const { provider } = fake(fixture("search-songs-page1"));
    const page = await provider.search({
      query: "x",
      kind: "song",
      offset: 0,
      limit: 20,
    });
    expect(page.next).toBeNull();
  });
  it("drops hour-long compilations but still advances the cursor", async () => {
    const { provider } = fake(fixture("playlist-open"));
    const page = await provider.collection({
      kind: "playlist",
      id: "PLgFC_SXvt6Lk4qThY0Wg3p-ehQXKq2lEr",
      offset: 0,
      limit: 5,
    });
    expect(page.tracks).toEqual([]);
    expect(page.next).toBe(5);
  });
});

describe("yt-dlp provider collections", () => {
  it("lists playlist hits from the filtered results page", async () => {
    const { provider, calls } = fake(fixture("search-playlists"));
    const page = await provider.search({
      query: "周杰伦",
      kind: "playlist",
      offset: 0,
      limit: 5,
    });
    expect(calls[0]!.at(-1)).toBe(
      "https://www.youtube.com/results?search_query=%E5%91%A8%E6%9D%B0%E4%BC%A6&sp=EgIQAw%253D%253D",
    );
    expect(page.tracks).toEqual([]);
    expect(page.collections).toHaveLength(5);
    expect(page.collections[0]).toEqual({
      kind: "playlist",
      id: "PLgFC_SXvt6Lk4qThY0Wg3p-ehQXKq2lEr",
      title: expect.stringContaining("周杰倫 精選"),
      subtitle: "周杰倫 Jay Chou",
      thumbnail: expect.stringMatching(/^https:\/\/i\.ytimg\.com\//),
    });
  });
  it("lists artist hits from the filtered results page", async () => {
    const { provider, calls } = fake(fixture("search-artists"));
    const page = await provider.search({
      query: "周杰伦",
      kind: "artist",
      offset: 0,
      limit: 5,
    });
    expect(calls[0]!.at(-1)).toContain("sp=EgIQAg%253D%253D");
    expect(page.collections.map((c) => c.id)).toEqual([
      "UC8CU5nVhCQIdAGrFFp4loOQ",
      "UCL2MDNdwEtV6aYUgNjFQGZA",
      "UCLkDAuXwoc-eAxDLziJ1dBw",
      "UCvDNns-sonnpUSgkismY3ZQ",
      "UCKUlsqazP-4QmxdEtUPlxOA",
    ]);
    expect(page.collections.every((c) => c.kind === "artist")).toBe(true);
  });
  it("opens a playlist by its list url, paged", async () => {
    const { provider, calls } = fake(fixture("playlist-open"));
    await provider.collection({
      kind: "playlist",
      id: "PLgFC_SXvt6Lk4qThY0Wg3p-ehQXKq2lEr",
      offset: 5,
      limit: 5,
    });
    expect(calls[0]!.slice(-3)).toEqual([
      "--playlist-items",
      "6-10",
      "https://www.youtube.com/playlist?list=PLgFC_SXvt6Lk4qThY0Wg3p-ehQXKq2lEr",
    ]);
  });
  it("opens a channel's videos and keeps only the song-length ones", async () => {
    const { provider, calls } = fake(fixture("channel-open"));
    const page = await provider.collection({
      kind: "artist",
      id: "UC8CU5nVhCQIdAGrFFp4loOQ",
      offset: 0,
      limit: 5,
    });
    expect(calls[0]!.at(-1)).toBe(
      "https://www.youtube.com/channel/UC8CU5nVhCQIdAGrFFp4loOQ/videos",
    );
    // 234 s, 30 s (promo clip), 80 s, 225 s, 190 s
    expect(page.tracks.map((t) => t.providerId)).toEqual([
      "yCWTHQ3_O-I",
      "C78yprnyGsM",
      "aGsrg1NO1cM",
      "PJyFND4-zR4",
    ]);
    expect(page.next).toBe(5);
  });
  it("rejects a collection id that is not an id", async () => {
    const { provider, calls } = fake({});
    await expect(
      provider.collection({
        kind: "playlist",
        id: "x&--exec=1",
        offset: 0,
        limit: 5,
      }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("yt-dlp provider albums and collection pages", () => {
  it("falls back to album-named playlists when the music shelf is empty", async () => {
    const { provider, calls } = routed({
      "music.youtube.com/search": fixture("search-albums-music"),
      "youtube.com/results": fixture("search-albums-web"),
    });
    const page = await provider.search({
      query: "周杰伦 范特西",
      kind: "album",
      offset: 0,
      limit: 10,
    });
    expect(calls[0]!.at(-1)).toBe(
      "https://music.youtube.com/search?q=%E5%91%A8%E6%9D%B0%E4%BC%A6%20%E8%8C%83%E7%89%B9%E8%A5%BF#albums",
    );
    expect(calls[1]!.at(-1)).toContain("%20album&sp=EgIQAw%253D%253D");
    expect(page.collections.length).toBeGreaterThan(0);
    expect(page.collections.every((c) => c.kind === "album")).toBe(true);
    expect(page.collections[0]!.title).toMatch(/范特西|專輯|专辑/);
    expect(page.collections[0]!.thumbnail).toMatch(/^https:\/\//);
    // the cursor follows the raw listing, not the album-named subset
    expect(page.next).toBe(10);
  });
  it("opens an album as a playlist and returns its header", async () => {
    const { provider, calls } = routed({
      "playlist?list=": fixture("playlist-songs"),
    });
    const page = await provider.collection({
      kind: "album",
      id: "OLAK5uy_abc-DEF",
      offset: 0,
      limit: 6,
    });
    expect(calls[0]!.at(-1)).toBe(
      "https://www.youtube.com/playlist?list=OLAK5uy_abc-DEF",
    );
    expect(page.collection).toMatchObject({
      kind: "album",
      id: "OLAK5uy_abc-DEF",
      title: "太陽之子 | Children of the Sun",
      thumbnail: expect.stringMatching(/^https:\/\/i\.ytimg\.com\//),
    });
    expect(page.tracks.map((t) => t.providerId)).toEqual([
      "yCWTHQ3_O-I",
      "C78yprnyGsM",
      "aGsrg1NO1cM",
      "PJyFND4-zR4",
      "a7ziV-RjqBo",
    ]);
    expect(page.next).toBe(6);
  });
  it("opens an artist with its songs, avatar and albums-or-playlists shelf", async () => {
    const { provider, calls } = routed({
      "/videos": fixture("channel-open"),
      "/releases": fixture("artist-releases-empty"),
      "/playlists": fixture("artist-playlists"),
    });
    const page = await provider.collection({
      kind: "artist",
      id: "UC8CU5nVhCQIdAGrFFp4loOQ",
      offset: 0,
      limit: 5,
    });
    expect(calls.map((c) => c.at(-1)!.split("/").pop()).sort()).toEqual([
      "playlists",
      "releases",
      "videos",
    ]);
    expect(page.collection).toMatchObject({
      kind: "artist",
      title: "周杰倫 Jay Chou",
      subtitle: "歌手",
    });
    expect(page.collection!.thumbnail).toMatch(/^https:\/\//);
    expect(page.tracks.length).toBeGreaterThan(0);
    expect(page.collections.length).toBeGreaterThan(0);
    expect(page.collections.every((c) => c.id.startsWith("PL"))).toBe(true);
  });
  it("loads an artist's shelf only with the first page and survives missing tabs", async () => {
    const { provider, calls } = routed({ "/videos": fixture("channel-open") });
    const first = await provider.collection({
      kind: "artist",
      id: "UC8CU5nVhCQIdAGrFFp4loOQ",
      offset: 0,
      limit: 5,
    });
    expect(first.collections).toEqual([]);
    expect(first.tracks.length).toBeGreaterThan(0);
    calls.length = 0;
    await provider.collection({
      kind: "artist",
      id: "UC8CU5nVhCQIdAGrFFp4loOQ",
      offset: 5,
      limit: 5,
    });
    expect(calls).toHaveLength(1);
  });
});
