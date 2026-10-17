// YtDlpProvider end to end against yt-dlp 2026.08.19 `--flat-playlist
// --dump-single-json` output (fixtures/) with the subprocess replaced by a fake.
// Recorded from the pinned binary plus the bundled talos-music plugin:
// search-artists, search-playlists(-page2), playlist-open(-page2), artist-page.
// The sandbox that recorded them is served no songs, albums or artist shelves
// by anonymous YouTube Music, so search-songs, search-albums, artist-page-shelf
// and album-open are hand-written in the plugin's documented output shape.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { YtDlpProvider } from "./provider.ts";
import type { Spawn } from "./provider.ts";

const PLUGIN = "/opt/talos/plugins";
const fixture = (
  name: string,
): Record<string, unknown> & { entries: Record<string, unknown>[] } =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  );
/** Answers by the url argument, like yt-dlp would; an unknown url fails. */
function routed(outputs: Record<string, unknown>) {
  const calls: string[][] = [];
  const spawn: Spawn = async (_file, args) => {
    calls.push(args);
    const hit = Object.entries(outputs).find(([key]) =>
      args.at(-1)!.includes(key),
    );
    if (!hit) throw new Error(`ERROR: no route for ${args.at(-1)}`);
    return { stdout: Buffer.from(JSON.stringify(hit[1])) };
  };
  return { provider: new YtDlpProvider("yt-dlp", spawn, PLUGIN), calls };
}
const searchArgs = (from: number, to: number, url: string) => [
  "--no-warnings",
  "--plugin-dirs",
  PLUGIN,
  "--flat-playlist",
  "--dump-single-json",
  "--playlist-items",
  `${from}-${to}`,
  url,
];

describe("yt-dlp provider search sections", () => {
  it.each([
    ["song", "songs"],
    ["album", "albums"],
    ["artist", "artists"],
    ["playlist", "playlists"],
  ] as const)("asks the YouTube Music %s section", async (kind, section) => {
    const { provider, calls } = routed({ "music.youtube.com/search": {} });
    await provider.search({ query: "周杰伦 晴天", kind, offset: 0, limit: 5 });
    expect(calls).toEqual([
      searchArgs(
        1,
        5,
        `https://music.youtube.com/search?q=${encodeURIComponent("周杰伦 晴天")}#${section}`,
      ),
    ]);
  });
  it("lists songs with artist, album and duration and keeps long ones", async () => {
    const { provider } = routed({ "#songs": fixture("search-songs") });
    const page = await provider.search({
      query: "晴天",
      kind: "song",
      offset: 0,
      limit: 3,
    });
    expect(page.tracks.map((t) => t.providerId)).toEqual([
      "Zr1xnP7ct3Y",
      "WbKoQ1GUOHg",
      "m9YbWBkAHBA",
    ]);
    expect(page.tracks[0]).toMatchObject({
      source: "youtube-music",
      artists: ["周杰倫"],
      album: "葉惠美",
      durationMs: 269000,
      url: "https://music.youtube.com/watch?v=Zr1xnP7ct3Y",
    });
    // A 30-minute mix labelled a song by the catalogue is still the catalogue's call.
    expect(page.tracks[2]!.durationMs).toBe(1_810_000);
    expect(page.collections).toEqual([]);
    expect(page.next).toBe(3);
  });
  it("lists albums as OLAK5uy_ playlists with artist and year", async () => {
    const { provider } = routed({ "#albums": fixture("search-albums") });
    const page = await provider.search({
      query: "周杰倫",
      kind: "album",
      offset: 0,
      limit: 5,
    });
    expect(page.tracks).toEqual([]);
    expect(page.collections).toEqual([
      expect.objectContaining({
        kind: "album",
        id: "OLAK5uy_nUxU1qD0JGoCgY1XdPvhd3wGMxpNiYx6g",
        title: "范特西",
        subtitle: "专辑 · 周杰倫 · 2001",
      }),
      expect.objectContaining({ title: "Jay", kind: "album" }),
    ]);
    expect(page.collections[0]!.thumbnail).toMatch(/^https:\/\//);
    expect(page.next).toBeNull();
  });
  it("lists artists recorded from the artists section", async () => {
    const { provider } = routed({ "#artists": fixture("search-artists") });
    const page = await provider.search({
      query: "周杰伦",
      kind: "artist",
      offset: 0,
      limit: 5,
    });
    expect(page.collections).toEqual([
      expect.objectContaining({
        kind: "artist",
        id: "UCL2MDNdwEtV6aYUgNjFQGZA",
        title: "Jay Chou",
        subtitle: "歌手",
      }),
    ]);
    expect(page.next).toBeNull();
  });
  it("lists playlists and pages with the offset", async () => {
    const { provider, calls } = routed({
      "#playlists": fixture("search-playlists-page2"),
    });
    const page = await provider.search({
      query: "周杰伦",
      kind: "playlist",
      offset: 5,
      limit: 5,
    });
    expect(calls[0]!.slice(-3, -1)).toEqual(["--playlist-items", "6-10"]);
    expect(page.collections.map((c) => c.id)).toEqual([
      "PLHqj6kISyn5iERA2kvFvh4Rwynb0B5tfH",
      "PLtbTn0wO-KJ5ms3D4old3dfQKeEN-4b_F",
      "PL5b5lj4hFW_XdMSn6MYfs3S9hU3gwUhfb",
      "PLkTqlozIJjRUNzyPcq0T-dquaWuATHpo_",
      "PLobG4XPCJ-GSKPEXHKXhGb1WIDo_xCmwr",
    ]);
    expect(page.collections[0]).toMatchObject({
      kind: "playlist",
      subtitle: "Vinnie VC",
    });
    expect(page.next).toBe(10);
  });
  it("drops entries of another kind and rows without a usable id", async () => {
    const { provider } = routed({
      "#playlists": {
        entries: [
          { ...fixture("search-playlists").entries[0], talos_kind: "artist" },
          { id: "x&y", title: "bad", talos_kind: "playlist" },
        ],
      },
    });
    const page = await provider.search({
      query: "q",
      kind: "playlist",
      offset: 0,
      limit: 5,
    });
    expect(page.collections).toEqual([]);
  });
  it("refuses to search without the plugin", async () => {
    const provider = new YtDlpProvider("yt-dlp", async () => {
      throw new Error("must not run");
    });
    await expect(
      provider.search({ query: "q", kind: "song", offset: 0, limit: 5 }),
    ).rejects.toThrow();
  });
});

describe("yt-dlp provider collections", () => {
  it("opens a playlist, keeping tracks longer than twenty minutes", async () => {
    const { provider, calls } = routed({
      "playlist?list=PLakXh": fixture("playlist-open"),
    });
    const page = await provider.collection({
      kind: "playlist",
      id: "PLakXhnGUu2l9dzRD1MPgV6UDURVx11NDK",
      offset: 0,
      limit: 5,
    });
    expect(calls[0]).toEqual(
      searchArgs(
        1,
        5,
        "https://music.youtube.com/playlist?list=PLakXhnGUu2l9dzRD1MPgV6UDURVx11NDK",
      ),
    );
    expect(page.tracks).toHaveLength(5);
    expect(page.tracks[0]!.durationMs).toBe(3_006_000);
    expect(page.collection).toMatchObject({
      kind: "playlist",
      id: "PLakXhnGUu2l9dzRD1MPgV6UDURVx11NDK",
      title: "Nedley Classical",
    });
    expect(page.next).toBe(5);
  });
  it("pages a playlist and ends on a short page", async () => {
    const { provider } = routed({
      "playlist?list=": fixture("playlist-open-page2"),
    });
    const page = await provider.collection({
      kind: "playlist",
      id: "PLakXhnGUu2l9dzRD1MPgV6UDURVx11NDK",
      offset: 5,
      limit: 5,
    });
    expect(page.tracks).toHaveLength(5);
    expect(page.next).toBe(10);
    const last = await provider.collection({
      kind: "playlist",
      id: "PLakXhnGUu2l9dzRD1MPgV6UDURVx11NDK",
      offset: 5,
      limit: 8,
    });
    expect(last.next).toBeNull();
  });
  it("skips private and deleted placeholders in a playlist", async () => {
    const entries = fixture("playlist-open").entries;
    const { provider } = routed({
      "playlist?list=": {
        title: "x",
        entries: [
          { ...entries[0], title: "[Private video]", id: "aaaaaaaaaaa" },
          { ...entries[1], title: "[Deleted video]", id: "bbbbbbbbbbb" },
          entries[2],
        ],
      },
    });
    const page = await provider.collection({
      kind: "playlist",
      id: "PLx",
      offset: 0,
      limit: 3,
    });
    expect(page.tracks).toHaveLength(1);
    expect(page.next).toBe(3);
  });
  it("opens an album as its OLAK5uy_ playlist with the album name as title", async () => {
    const { provider, calls } = routed({ OLAK5uy_nUxU: fixture("album-open") });
    const page = await provider.collection({
      kind: "album",
      id: "OLAK5uy_nUxU1qD0JGoCgY1XdPvhd3wGMxpNiYx6g",
      offset: 0,
      limit: 20,
    });
    expect(calls[0]!.at(-1)).toBe(
      "https://music.youtube.com/playlist?list=OLAK5uy_nUxU1qD0JGoCgY1XdPvhd3wGMxpNiYx6g",
    );
    expect(page.collection).toMatchObject({
      kind: "album",
      title: "范特西",
      subtitle: "专辑 · 周杰倫 · 10 首",
    });
    expect(page.tracks.map((t) => t.title)).toEqual(["爱在西元前"]);
  });
  it("opens an artist through the plugin: header, shelf songs and albums", async () => {
    const { provider, calls } = routed({
      "talos-music:artist:UCL2": {
        ...fixture("artist-page-shelf"),
        talos_songs_playlist: null,
      },
    });
    const page = await provider.collection({
      kind: "artist",
      id: "UCL2MDNdwEtV6aYUgNjFQGZA",
      offset: 0,
      limit: 20,
    });
    expect(calls[0]).toEqual([
      "--no-warnings",
      "--plugin-dirs",
      PLUGIN,
      "--flat-playlist",
      "--dump-single-json",
      "talos-music:artist:UCL2MDNdwEtV6aYUgNjFQGZA",
    ]);
    expect(page.collection).toMatchObject({
      kind: "artist",
      title: "Jay Chou",
      subtitle: "歌手",
    });
    expect(page.collection!.thumbnail).toMatch(/^https:\/\//);
    expect(page.tracks.map((t) => t.providerId)).toEqual(["Zr1xnP7ct3Y"]);
    expect(page.collections.map((c) => [c.kind, c.title])).toEqual([
      ["album", "范特西"],
    ]);
    expect(page.next).toBeNull();
  });
  it("pages an artist's songs through the see-all playlist, albums only once", async () => {
    const { provider, calls } = routed({
      "talos-music:artist:UCL2": fixture("artist-page-shelf"),
      "playlist?list=OLAK5uy_kSongs": fixture("playlist-open"),
    });
    const first = await provider.collection({
      kind: "artist",
      id: "UCL2MDNdwEtV6aYUgNjFQGZA",
      offset: 0,
      limit: 5,
    });
    expect(first.tracks).toHaveLength(5);
    expect(first.collections).toHaveLength(1);
    expect(first.next).toBe(5);
    const second = await provider.collection({
      kind: "artist",
      id: "UCL2MDNdwEtV6aYUgNjFQGZA",
      offset: 5,
      limit: 5,
    });
    expect(second.collections).toEqual([]);
    expect(calls.at(-1)!.slice(-3)).toEqual([
      "--playlist-items",
      "6-10",
      expect.stringContaining("OLAK5uy_kSongs"),
    ]);
  });
  it("opens a recorded artist page that lists no songs or albums", async () => {
    const { provider } = routed({
      "talos-music:artist:": fixture("artist-page"),
    });
    const page = await provider.collection({
      kind: "artist",
      id: "UCL2MDNdwEtV6aYUgNjFQGZA",
      offset: 0,
      limit: 20,
    });
    expect(page.collection).toMatchObject({ title: "Jay Chou" });
    expect(page.tracks).toEqual([]);
    expect(page.collections).toEqual([]);
    expect(page.next).toBeNull();
  });
  it("rejects a collection id that is not an id", async () => {
    const { provider, calls } = routed({});
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
