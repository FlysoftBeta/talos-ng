import { describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { FileStore } from "@talos/store";
import { sha256Hex } from "@talos/base";
import type { Row } from "@talos/sync";
import { openAppDb } from "../../platform/storage/database.ts";
import { EvictionManager } from "./eviction.ts";

const windowed = {
  post: { seqOf: (row: Row) => (row.data as { seq?: number }).seq ?? 0 },
};

describe("one storage eviction policy", () => {
  it("evicts LRU caches before expired retention and never retained content or user intent", async () => {
    const db = await openAppDb({
      name: "quota",
      indexedDB: new IDBFactory(),
      keyRange: IDBKeyRange,
      channel: null,
    });
    let now = 1;
    const files = new FileStore(db, { clock: () => now });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const bytes = new Uint8Array(100).fill(i);
      const id = sha256Hex(bytes);
      ids.push(id);
      await files.put(id, bytes);
      await files.retain(`u:library:d${i}:retained`, id);
      now++;
    }
    await db.table("kv").put(
      [
        { doc: "d2", expires: 2 },
        { doc: "d3", expires: 1000 },
      ],
      "feature:u:library:retained",
    );
    await db.table("rows").put({
      scope: "me:u",
      type: "libraryDoc",
      id: "d3",
      rev: 1,
      deleted: false,
      data: {},
    });
    await db.table("rows").put({
      scope: "me:u",
      type: "libraryRetention",
      id: "d3",
      rev: 1,
      deleted: false,
      data: { kind: "doc", value: { v: 1, t: { ms: 1 } }, lastUsed: 0 },
    });
    await db.table("outbox").put([{ op: "pending" }], "u");
    await db.table("kv").put("draft", "feature:u:ai:text:draft");
    let usage = 400;
    const manager = new EvictionManager(db, {
      windowed,
      now: () => now,
      estimate: async () => ({ usage, quota: 400 }),
      exhausted: vi.fn(),
    });
    manager.touch(ids[0]!);
    await manager.makeRoom(0);
    expect(await files.has(ids[1]!)).toBe(false);
    expect(await files.has(ids[0]!)).toBe(true);
    expect(await files.has(ids[2]!)).toBe(true);
    usage = 1000;
    await manager.makeRoom(0);
    expect(await files.has(ids[2]!)).toBe(false);
    expect(await files.has(ids[3]!)).toBe(true);
    expect(await db.table("outbox").get("u")).toEqual([{ op: "pending" }]);
    expect(await db.table("kv").get("feature:u:ai:text:draft")).toBe("draft");
    db.close();
  });
  it.each(["feature:u:ai:full:message:1", "feature:u:ai:file:note.txt:1"])(
    "uses tracked bytes without StorageManager for %s",
    async (key) => {
      const db = await openAppDb({
        name: "fallback",
        indexedDB: new IDBFactory(),
        keyRange: IDBKeyRange,
        channel: null,
      });
      const manager = new EvictionManager(db, {
        windowed,
        estimate: async () => {
          throw new Error("unavailable");
        },
        fallbackBytes: 100,
        exhausted: vi.fn(),
      });
      await db.table("kv").put("x".repeat(100), key);
      await manager.track(key, "x".repeat(100));
      await manager.makeRoom(1);
      expect(await db.table("kv").get(key)).toBeUndefined();
      db.close();
    },
  );
  it("retries a quota-aborted transaction once and reports exhaustion", async () => {
    const db = await openAppDb({
      name: "retry",
      indexedDB: new IDBFactory(),
      keyRange: IDBKeyRange,
      channel: null,
    });
    const recover = vi.fn(async () => {}),
      exhausted = vi.fn();
    db.setQuotaRecovery(recover, exhausted);
    let attempts = 0;
    await db.tx(["kv"], "readwrite", (tx) => {
      if (++attempts === 1)
        throw new DOMException("full", "QuotaExceededError");
      return tx.table("kv").put("saved", "key");
    });
    expect(attempts).toBe(2);
    expect(exhausted).not.toHaveBeenCalled();
    attempts = 0;
    await expect(
      db.tx(["kv"], "readwrite", () => {
        attempts++;
        throw new DOMException("full", "QuotaExceededError");
      }),
    ).rejects.toMatchObject({ code: "E_TOO_LARGE" });
    expect(attempts).toBe(2);
    expect(exhausted).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledTimes(2);
    db.close();
  });
});

it("rechecks retention changed by another tab after candidate discovery", async () => {
  const db = await openAppDb({
    name: "race",
    indexedDB: new IDBFactory(),
    keyRange: IDBKeyRange,
    channel: null,
  });
  const files = new FileStore(db);
  const bytes = new Uint8Array(100),
    rid = sha256Hex(bytes);
  await files.put(rid, bytes);
  await files.retain("u:library:d:retained", rid);
  const manager = new EvictionManager(db, {
    windowed,
    now: () => 100,
    exhausted: vi.fn(),
    estimate: async () => {
      await db.table("rows").put({
        scope: "me:u",
        type: "libraryRetention",
        id: "d",
        rev: 1,
        deleted: false,
        data: { kind: "doc", value: { v: 7, t: { ms: 100 } }, lastUsed: 0 },
      });
      return { usage: 1000000, quota: 100 };
    },
  });
  await manager.makeRoom(0);
  expect(await files.has(rid)).toBe(true);
  db.close();
});
