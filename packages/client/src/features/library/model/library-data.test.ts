import { describe, expect, it } from "vitest";
import {
  contract,
  emptyLibraryState,
  libraryStateSchema,
} from "@talos/contract";
import type { LibraryCollection, LibraryDoc } from "@talos/contract";
import type { StoredRow } from "../../../core/data/db.ts";
import { libraryModule } from "../module.ts";
import {
  collectionLevel,
  collectionOfPage,
  collectionRows,
  decodeLibrary,
  documentRows,
  emptyShelf,
  groupChoices,
  writableCollections,
} from "./library-data.ts";
import type { LibraryData } from "./library-data.ts";
const user = "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  doc = "01ARZ3NDEKTSV4RRFFQ69G5FAX",
  collection = "01ARZ3NDEKTSV4RRFFQ69G5FAW",
  device = "01ARZ3NDEKTSV4RRFFQ69G5FAY";
const value = (v: boolean, ms: number) => ({
  v,
  t: { ms, counter: 0 },
  op: user,
});
const row = (
  type: string,
  id: string,
  data: unknown,
  scope = `me:${user}`,
  rev = 1,
): StoredRow => ({ scope, type, id, data, rev, deleted: false });
const document: LibraryDoc = {
  id: doc,
  title: "测试文档",
  owner: user,
  created: 1,
  kind: "flow",
  status: "ready",
  pack: null,
  units: 3,
  chars: 12000,
};
describe("library durable projections", () => {
  it("queues favourites and rejects stale LWW writes without mutating source", () => {
    const original = row("libraryState", doc, {
      ...emptyLibraryState(doc),
      favourite: value(true, 20),
    });
    const result = libraryModule.reducers["library.favourite.set"](
      [original],
      { doc, value: value(false, 10) },
      { user, op: user },
    );
    expect(libraryStateSchema.parse(result[0]!.data).favourite?.v).toBe(true);
    expect(original.data).toEqual({
      ...emptyLibraryState(doc),
      favourite: value(true, 20),
    });
    expect(contract.library.favourite.set.offline).toBe("queue");
  });
  it("preserves furthest position and per-device Max seconds while resume can move backwards", () => {
    const reduce = libraryModule.reducers["library.progress.set"];
    let rows: readonly StoredRow[] = [];
    for (const [unit, furthest, seconds, ms] of [
      [8, 8, 100, 10],
      [2, 2, 50, 20],
      [4, 4, 120, 15],
    ])
      rows = reduce(
        rows,
        {
          doc,
          device,
          resume: { v: { unit, offset: 40 }, t: { ms, counter: 0 }, op: user },
          furthest,
          seconds,
        },
        { user, op: user },
      );
    const state = libraryStateSchema.parse(rows[0]!.data);
    expect(state.resume?.v).toEqual({ unit: 2, offset: 40 });
    expect(state.furthest).toBe(8);
    expect(state.seconds[device]).toBe(120);
  });
  it("replays retention with deterministic LWW and ignores malformed intents", () => {
    const rows = libraryModule.reducers["library.retention.set"](
      [],
      { doc, value: { v: 7, t: { ms: 10, counter: 0 }, op: user } },
      { user, op: user },
    );
    expect(libraryStateSchema.parse(rows[0]!.data).retention?.v).toBe(7);
    expect(
      libraryModule.reducers["library.retention.set"](
        rows,
        { doc, value: 0 },
        { user, op: user },
      ),
    ).toBe(rows);
  });
  it("merges duplicate me/coll collection rows once and takes newest revision", () => {
    const base = {
      id: collection,
      title: "旧书单",
      owner: user,
      group: null,
      docs: [doc],
    };
    const result = decodeLibrary([
      row(
        "libraryCollection",
        collection,
        { ...base, title: "新书单" },
        `coll:${collection}`,
        2,
      ),
      row("libraryCollection", collection, base),
    ]);
    expect(result.collections).toHaveLength(1);
    expect(result.collections[0]!.title).toBe("新书单");
  });
  it("never admits stale shared documents removed from a collection", () => {
    const coll = row(
      "libraryCollection",
      collection,
      { id: collection, title: "共享书单", owner: user, group: null, docs: [] },
      `coll:${collection}`,
      2,
    );
    expect(
      decodeLibrary([
        coll,
        row("libraryDoc", doc, document, `coll:${collection}`),
      ]).docs,
    ).toEqual([]);
    expect(
      decodeLibrary([
        coll,
        row("libraryDoc", doc, document, `coll:${collection}`),
        row("libraryDoc", doc, document),
      ]).docs,
    ).toHaveLength(1);
  });
  it("uses owner and synced effective grants for edit affordances", () => {
    const coll = {
      id: collection,
      title: "书单",
      owner: user,
      group: null,
      docs: [],
    };
    const data = decodeLibrary([
      row("grant", collection, {
        resource: `coll:${collection}`,
        level: "write",
      }),
    ]);
    expect(collectionLevel(data, coll, user)).toBe("own");
    expect(collectionLevel(data, coll, device)).toBe("write");
    expect(collectionLevel(decodeLibrary([]), coll, device)).toBe("read");
  });
});

describe("library list selectors", () => {
  const withDocs = (): LibraryData => {
    const a = { ...document, id: "a", title: "甲", created: 1 },
      b = { ...document, id: "b", title: "乙", created: 2 };
    return {
      docs: [b, a],
      collections: [
        {
          id: "c1",
          title: "群组书单",
          owner: user,
          group: "g1",
          docs: ["a"],
        } as unknown as LibraryCollection,
        {
          id: "c2",
          title: "个人书单",
          owner: "other",
          docs: [],
        } as unknown as LibraryCollection,
      ],
      states: new Map([
        ["a", { ...emptyLibraryState("a"), favourite: value(true, 5) }],
      ]) as LibraryData["states"],
      rows: [
        row("communityConversation", "g1", { kind: "group", title: "读书会" }),
        row("communityConversation", "d1", { kind: "direct", title: "私聊" }),
      ],
    };
  };
  it("narrows documents to favourites and marks the open document", () => {
    const data = withDocs();
    expect(documentRows(data, "recent", undefined).map((r) => r.id)).toEqual([
      "b",
      "a",
    ]);
    const favourites = documentRows(data, "favourite", {
      kind: "document",
      id: "a",
    });
    expect(favourites.map((r) => [r.id, r.selected])).toEqual([["a", true]]);
  });
  it("filters booklists by group and offers only group conversations", () => {
    const data = withDocs();
    expect(collectionRows(data, "g1", undefined).map((r) => r.id)).toEqual([
      "c1",
    ]);
    expect(collectionRows(data, "", undefined)).toHaveLength(2);
    expect(groupChoices(data)).toEqual([{ id: "g1", title: "读书会" }]);
  });
  it("offers writable booklists as destinations", () => {
    expect(writableCollections(withDocs(), user)).toEqual([
      { id: "c1", title: "群组书单" },
    ]);
  });
  it("identifies collection pages and empty-shelf placeholders", () => {
    expect(collectionOfPage({ kind: "page", id: "collection:c9" })).toBe("c9");
    expect(collectionOfPage({ kind: "page", id: "other" })).toBeUndefined();
    expect(emptyShelf("favourite", "offline")).toEqual({
      state: "offline",
      title: "还没有收藏",
    });
  });
});
