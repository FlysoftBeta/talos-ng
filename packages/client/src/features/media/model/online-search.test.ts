import { describe, expect, it } from "vitest";
import type { MediaTrack } from "@talos/contract";
import { OnlineSearch } from "./online-search.ts";
import type { OnlineCollection } from "./actions.ts";

const track = (id: string): MediaTrack =>
  ({
    id,
    title: id,
    artists: [],
    album: null,
    durationMs: 1,
  }) as unknown as MediaTrack;
const coll = (
  kind: OnlineCollection["kind"],
  id: string,
): OnlineCollection => ({
  kind,
  id,
  title: `${kind}-${id}`,
  subtitle: "",
  thumbnail: null,
});
/** A media.search / media.collection.open server with 45 songs and one artist page. */
function server() {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = [];
  const port = {
    command: async (
      method: { name: string },
      args: Record<string, unknown>,
    ) => {
      calls.push({ method: method.name, args });
      const offset = args["offset"] as number;
      const limit = args["limit"] as number;
      if (method.name === "media.search") {
        if (args["kind"] === "song") {
          const rest = Math.max(0, 45 - offset);
          const n = Math.min(limit, rest);
          return {
            tracks: Array.from({ length: n }, (_, i) =>
              track(`s${offset + i}`),
            ),
            collections: [],
            collection: null,
            next: n === limit ? offset + limit : null,
          };
        }
        return {
          tracks: [],
          collections: [coll(args["kind"] as "album", `${args["kind"]}1`)],
          collection: null,
          next: null,
        };
      }
      const id = args["id"] as string;
      return {
        tracks: [track(`${id}-t${offset}`)],
        collections:
          offset === 0 && args["kind"] === "artist"
            ? [coll("album", "al1")]
            : [],
        collection: {
          ...coll(args["kind"] as "album", id),
          thumbnail: "https://x/y.jpg",
        },
        next: offset === 0 ? 20 : null,
      };
    },
  };
  return { port: port as never, calls };
}
const user = "u1";
const tab = (s: OnlineSearch) => s.get().kind;

describe("online search model", () => {
  it("searches songs by default and pages with load-more", async () => {
    const s = new OnlineSearch(),
      { port, calls } = server();
    s.setQuery(user, "晴天");
    await s.search(user, port);
    expect(s.get().results).toHaveLength(20);
    expect(s.get().next).toBe(20);
    expect(calls[0]!.args).toMatchObject({
      query: "晴天",
      kind: "song",
      offset: 0,
    });
    await s.loadMore(user, port);
    expect(s.get().results).toHaveLength(40);
    await s.loadMore(user, port);
    expect(s.get().results).toHaveLength(45);
    expect(s.get().next).toBeNull();
    const before = calls.length;
    await s.loadMore(user, port);
    expect(calls).toHaveLength(before);
    expect(new Set(s.get().results.map((t) => t.id)).size).toBe(45);
  });
  it("switches tabs: hits replace the list and the old page is dropped", async () => {
    const s = new OnlineSearch(),
      { port } = server();
    s.setQuery(user, "q");
    await s.search(user, port);
    for (const kind of ["playlist", "album", "artist"] as const) {
      await s.search(user, port, kind);
      expect(tab(s)).toBe(kind);
      expect(s.get().results).toEqual([]);
      expect(s.get().collections.map((c) => c.id)).toEqual([`${kind}1`]);
      expect(s.get().next).toBeNull();
    }
    // a later search without a tab stays on the current one
    await s.search(user, port);
    expect(tab(s)).toBe("artist");
    await s.search(user, port, "song");
    expect(s.get().results.length).toBeGreaterThan(0);
    expect(s.get().collections).toEqual([]);
  });
  it("ignores a blank query", async () => {
    const s = new OnlineSearch(),
      { port, calls } = server();
    s.setQuery(user, "   ");
    await s.search(user, port);
    expect(calls).toEqual([]);
    expect(s.get().searched).toBe(false);
  });
  it("opens a collection page with its header, albums and its own paging", async () => {
    const s = new OnlineSearch(),
      { port, calls } = server();
    s.setQuery(user, "q");
    await s.search(user, port, "artist");
    await s.open(user, port, coll("artist", "UC1"));
    expect(calls.at(-1)).toMatchObject({
      method: "media.collection.open",
      args: { kind: "artist", id: "UC1", offset: 0 },
    });
    expect(s.get().opened).toMatchObject({
      id: "UC1",
      thumbnail: "https://x/y.jpg",
    });
    expect(s.get().results.map((t) => t.id)).toEqual(["UC1-t0"]);
    expect(s.get().collections.map((c) => c.id)).toEqual(["al1"]);
    await s.loadMore(user, port);
    expect(calls.at(-1)).toMatchObject({
      method: "media.collection.open",
      args: { id: "UC1", offset: 20 },
    });
    expect(s.get().results.map((t) => t.id)).toEqual(["UC1-t0", "UC1-t20"]);
    expect(s.get().collections).toHaveLength(1);
    expect(s.get().next).toBeNull();
  });
  it("opens an album from an artist page and goes back through the trail", async () => {
    const s = new OnlineSearch(),
      { port, calls } = server();
    s.setQuery(user, "q");
    await s.search(user, port, "artist");
    await s.open(user, port, coll("artist", "UC1"));
    await s.open(user, port, coll("album", "al1"));
    expect(s.get().trail.map((c) => c.id)).toEqual(["UC1", "al1"]);
    expect(s.get().opened!.id).toBe("al1");
    await s.back(user, port);
    expect(s.get().opened!.id).toBe("UC1");
    expect(s.get().collections.map((c) => c.id)).toEqual(["al1"]);
    await s.back(user, port);
    expect(s.get().opened).toBeNull();
    expect(s.get().trail).toEqual([]);
    expect(calls.at(-1)).toMatchObject({
      method: "media.search",
      args: { kind: "artist", offset: 0 },
    });
    expect(s.get().collections.map((c) => c.id)).toEqual(["artist1"]);
  });
  it("keeps what was loaded and reports an error when a page fails", async () => {
    const s = new OnlineSearch(),
      { port } = server();
    s.setQuery(user, "q");
    await s.search(user, port);
    const failing = {
      command: async () => {
        throw new Error("音乐来源暂时不可用");
      },
    } as never;
    await s.loadMore(user, failing);
    expect(s.get().error).toBe("音乐来源暂时不可用");
    expect(s.get().results).toHaveLength(20);
    expect(s.get().busy).toBe(false);
    await s.loadMore(user, port);
    expect(s.get().error).toBe("");
    expect(s.get().results).toHaveLength(40);
  });
  it("does not let another account see or extend the results", async () => {
    const s = new OnlineSearch(),
      { port, calls } = server();
    s.setQuery(user, "q");
    await s.search(user, port);
    const n = calls.length;
    await s.loadMore("u2", port);
    expect(calls).toHaveLength(n);
    s.setQuery("u2", "other");
    expect(s.get().user).toBe("u2");
    expect(s.get().results).toEqual([]);
  });
});
