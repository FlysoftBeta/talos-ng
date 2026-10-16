import { describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { FileStore } from "@talos/store";
import { sha256Hex } from "@talos/base";
import { openAppDb } from "../../platform/storage/database.ts";
import { EvictionManager } from "./eviction.ts";

const DAY = 86_400_000;
async function fixture(name: string) {
  const db = await openAppDb({
    name,
    indexedDB: new IDBFactory(),
    keyRange: IDBKeyRange,
    channel: null,
  });
  let now = 1_800_000_000_000;
  const files = new FileStore(db, { clock: () => now });
  const put = async (byte: number, ...owners: string[]) => {
    const bytes = new Uint8Array(100).fill(byte);
    const rid = sha256Hex(bytes);
    await files.put(rid, bytes);
    for (const owner of owners) await files.retain(owner, rid);
    now += 10;
    return rid;
  };
  const row = (r: Record<string, unknown>) =>
    db.table("rows").put({ deleted: false, rev: 1, ...r });
  const manager = (usage: number, extra: object = {}) =>
    new EvictionManager(db, {
      now: () => now,
      estimate: async () => ({ usage, quota: 400 }),
      exhausted: vi.fn(),
      ...extra,
    });
  return {
    db,
    files,
    put,
    row,
    manager,
    clock: () => now,
    advance: (ms: number) => (now += ms),
  };
}

describe("eviction retention policies", () => {
  it("keeps a chat image inside its week-retention window and frees it afterwards", async () => {
    const f = await fixture("chat-week");
    const rid = await f.put(1, "u:conv:c1:body:p1");
    await f.row({
      scope: "me:u",
      type: "chatState",
      id: "c1",
      data: { retention: { v: "week" } },
    });
    await f.row({
      scope: "conv:c1",
      type: "post",
      id: "p1",
      data: {
        created: f.clock() - DAY,
        image: { original: { rid }, thumbnail: { rid } },
      },
    });
    await f.manager(10_000).makeRoom(0);
    expect(await f.files.has(rid)).toBe(true);
    f.advance(7 * DAY);
    await f.manager(10_000).makeRoom(0);
    expect(await f.files.has(rid)).toBe(false);
    f.db.close();
  });

  it("protects a conversation file without any matching post under a retention policy", async () => {
    const f = await fixture("chat-orphan");
    const rid = await f.put(2, "u:conv:c2:image");
    await f.row({
      scope: "me:u",
      type: "chatState",
      id: "c2",
      data: { retention: { v: "half-year" } },
    });
    await f.manager(10_000).makeRoom(0);
    expect(await f.files.has(rid)).toBe(true);
    f.db.close();
  });

  it("honours my playlist policy from my own last use, independent of shared list metadata", async () => {
    const f = await fixture("media-retention");
    const rid = await f.put(3, "u:media:t1:retained");
    await f.row({
      scope: "coll:pl1",
      type: "mediaPlaylist",
      id: "pl1",
      data: { tracks: ["t1"] },
    });
    await f.row({ scope: "coll:pl1", type: "mediaTrack", id: "t1", data: {} });
    await f.row({
      scope: "me:u",
      type: "mediaRetention",
      id: "pl1",
      data: {
        kind: "playlist",
        value: { v: 30, t: { ms: f.clock() - 40 * DAY } },
        lastUsed: f.clock() - DAY,
      },
    });
    await f.manager(10_000).makeRoom(0);
    expect(await f.files.has(rid)).toBe(true);
    f.advance(30 * DAY);
    await f.manager(10_000).makeRoom(0);
    expect(await f.files.has(rid)).toBe(false);
    f.db.close();
  });

  it("does not let stale bookkeeping or a deleted policy pin files", async () => {
    const f = await fixture("kv-retention");
    const rid = await f.put(4, "u:library:d1:retained");
    await f.row({
      scope: "me:u",
      type: "libraryRetention",
      id: "d1",
      deleted: true,
      data: {
        kind: "doc",
        value: { v: 365, t: { ms: f.clock() } },
        lastUsed: 0,
      },
    });
    await f.db
      .table("kv")
      .put(
        [{ doc: "d1", expires: f.clock() + 5 * DAY }],
        "feature:u:library:retained",
      );
    await f.manager(10_000).makeRoom(0);
    expect(await f.files.has(rid)).toBe(false);
    f.db.close();
  });
  it("never uses another user's personal policy to protect my copy", async () => {
    const f = await fixture("two-users");
    const rid = await f.put(7, "alice:media:t:retained");
    await f.row({
      scope: "coll:shared",
      type: "mediaTrack",
      id: "t",
      data: {},
    });
    await f.row({
      scope: "coll:shared",
      type: "mediaPlaylist",
      id: "shared",
      data: { tracks: ["t"] },
    });
    await f.row({
      scope: "me:bob",
      type: "mediaRetention",
      id: "shared",
      data: {
        kind: "playlist",
        value: { v: 365, t: { ms: f.clock() } },
        lastUsed: 0,
      },
    });
    await f.manager(10_000).makeRoom(0);
    expect(await f.files.has(rid)).toBe(false);
    f.db.close();
  });
  it("does not protect a stale shared item with a direct pin after membership revocation", async () => {
    const f = await fixture("revoked-direct");
    const rid = await f.put(9, "u:library:d:retained");
    await f.row({ scope: "coll:c", type: "libraryDoc", id: "d", data: {} });
    await f.row({
      scope: "coll:c",
      type: "libraryCollection",
      id: "c",
      data: { docs: [] },
    });
    await f.row({
      scope: "me:u",
      type: "libraryRetention",
      id: "d",
      data: {
        kind: "doc",
        value: { v: 30, t: { ms: f.clock() } },
        lastUsed: 0,
      },
    });
    await f.manager(10_000).makeRoom(0);
    expect(await f.files.has(rid)).toBe(false);
    f.db.close();
  });
  it("removes collection protection as soon as membership disappears", async () => {
    const f = await fixture("membership");
    const rid = await f.put(8, "u:library:d:retained");
    await f.row({ scope: "coll:c", type: "libraryDoc", id: "d", data: {} });
    await f.row({
      scope: "coll:c",
      type: "libraryCollection",
      id: "c",
      data: { docs: ["d"] },
    });
    await f.row({
      scope: "me:u",
      type: "libraryRetention",
      id: "c",
      data: {
        kind: "collection",
        value: { v: 7, t: { ms: f.clock() } },
        lastUsed: 0,
      },
    });
    await f.manager(10_000).makeRoom(0);
    expect(await f.files.has(rid)).toBe(true);
    await f.row({
      scope: "coll:c",
      type: "libraryCollection",
      id: "c",
      data: { docs: [] },
    });
    await f.manager(10_000).makeRoom(0);
    expect(await f.files.has(rid)).toBe(false);
    f.db.close();
  });
});

describe("eviction safety", () => {
  it("never removes a file whose writer lease is still held, nor an incomplete upload", async () => {
    const f = await fixture("lease");
    const rid = await f.put(5, "u:library:d:x");
    const partial = sha256Hex(new Uint8Array(100).fill(6));
    const writer = await f.files.begin(partial, 100);
    await writer.append(new Uint8Array(40));
    await f.db
      .table("file_leases")
      .put({ rid, token: "t", expires: f.clock() + 60_000 });
    await f.manager(10_000).makeRoom(0);
    expect(await f.files.has(rid)).toBe(true);
    expect(
      (await f.db.table("file_heads").get(partial)) as unknown,
    ).toBeTruthy();
    await writer.close();
    f.db.close();
  });

  it("evicts mirrored posts only with an empty outbox, resetting the scope cursor", async () => {
    const f = await fixture("mirror");
    await f.row({
      scope: "conv:c",
      type: "post",
      id: "old",
      data: { created: 1 },
    });
    await f.row({ scope: "conv:c", type: "chatState", id: "keep", data: {} });
    await f.db.table("scopes").put({ scope: "conv:c", cursor: 9 });
    await f.db.table("outbox").put([{ op: "pending" }], "u");
    await f.manager(10_000).makeRoom(0);
    expect(
      await f.db.table("rows").get(["conv:c", "post", "old"]),
    ).toBeTruthy();
    await f.db.table("outbox").put([], "u");
    const evicted = vi.fn(async () => {});
    await f.manager(10_000, { onEvicted: evicted }).makeRoom(0);
    expect(
      await f.db.table("rows").get(["conv:c", "post", "old"]),
    ).toBeUndefined();
    expect(
      await f.db.table("rows").get(["conv:c", "chatState", "keep"]),
    ).toBeTruthy();
    expect(await f.db.table("scopes").get("conv:c")).toEqual({
      scope: "conv:c",
      cursor: 0,
    });
    expect(evicted).toHaveBeenCalledOnce();
    f.db.close();
  });

  it("does nothing under the 90% watermark and force still frees at least 1 MiB worth", async () => {
    const f = await fixture("watermark");
    const rid = await f.put(7);
    await f.manager(100).makeRoom(0);
    expect(await f.files.has(rid)).toBe(true);
    await f.manager(100).makeRoom(0, true);
    expect(await f.files.has(rid)).toBe(false);
    f.db.close();
  });

  it("serialises overlapping makeRoom calls", async () => {
    const f = await fixture("serial");
    let running = 0,
      peak = 0;
    const manager = f.manager(0, {
      estimate: async () => {
        peak = Math.max(peak, ++running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return { usage: 0, quota: 400 };
      },
    });
    await Promise.all([
      manager.makeRoom(0),
      manager.makeRoom(0),
      manager.makeRoom(0),
    ]);
    expect(peak).toBe(1);
    f.db.close();
  });

  it("only tracks reconstructible cache keys", async () => {
    const f = await fixture("track");
    const manager = f.manager(0);
    await manager.track("feature:u:ai:text:draft", "x");
    await manager.track("feature:u:conv:c:body:p", "abc");
    const entries = await f.db
      .table<{ key: string; bytes: number }>("cache_entries")
      .range();
    expect(entries.map((e) => [e.key, e.bytes])).toEqual([
      ["feature:u:conv:c:body:p", 10],
    ]);
    f.db.close();
  });
});
