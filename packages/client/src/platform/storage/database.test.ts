import { describe, expect, it } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { openDb, FileStore } from "@talos/store";
import { sha256Hex } from "@talos/base";
import { appMigrations, openAppDb } from "./database.ts";
describe("app file-store migration", () => {
  it("upgrades version one without losing protected intent and verifies binary files", async () => {
    const indexedDB = new IDBFactory();
    const options = {
      name: "upgrade",
      indexedDB,
      keyRange: IDBKeyRange,
      channel: null,
    };
    const old = await openDb({ ...options, schema: appMigrations.slice(0, 1) });
    await old
      .table("outbox")
      .put([{ op: "pending", args: { draft: "保留草稿" } }], "alice");
    await old.table("session").put({ token: "saved" }, "active");
    old.close();
    const db = await openAppDb(options);
    try {
      expect(await db.table("outbox").get("alice")).toEqual([
        { op: "pending", args: { draft: "保留草稿" } },
      ]);
      expect(await db.table("session").get("active")).toEqual({
        token: "saved",
      });
      const bytes = new Uint8Array([0, 127, 255]);
      const rid = sha256Hex(bytes);
      const files = new FileStore(db);
      await files.put(rid, bytes);
      await files.retain("alice:chat:conversation", rid);
      expect(new Uint8Array(await files.read(rid))).toEqual(bytes);
      expect(
        Object.prototype.toString.call(
          (await db.table<{ bytes: unknown }>("file_chunks").range())[0]!.bytes,
        ),
      ).toBe("[object ArrayBuffer]");
      expect(await files.owners(rid)).toEqual(["alice:chat:conversation"]);
    } finally {
      db.close();
    }
  });
});

it("discards old personal media mirrors and unscoped audio owners on upgrade without losing outbox intent", async () => {
  const options = {
    name: "media-upgrade",
    indexedDB: new IDBFactory(),
    keyRange: IDBKeyRange,
    channel: null,
  };
  const old = await openDb({ ...options, schema: appMigrations.slice(0, 3) });
  const row = {
    scope: "me:alice",
    type: "mediaTrack",
    id: "lost-track",
    rev: 8,
    deleted: false,
    data: { title: "private" },
  };
  await old.table("rows").put(row);
  await old.table("scopes").put({ scope: "me:alice", cursor: 8 });
  await old.table("outbox").put([{ op: "pending" }], "alice");
  const files = new FileStore(old);
  const bytes = new Uint8Array([1, 2, 3]);
  const rid = sha256Hex(bytes);
  await files.put(rid, bytes);
  await files.retain("alice:media:playlist:lost-track", rid);
  old.close();
  const db = await openAppDb(options);
  try {
    expect(await db.table("rows").range()).toEqual([]);
    expect(await db.table("scopes").get("me:alice")).toBeUndefined();
    expect(await db.table("outbox").get("alice")).toEqual([{ op: "pending" }]);
    const current = new FileStore(db);
    expect(await current.owners(rid)).toEqual([]);
    await current.gc({ incompleteOlderThanMs: 86400000 });
    expect(await current.has(rid)).toBe(false);
  } finally {
    db.close();
  }
});

it("drops cached learning rows, scope, setting and queued answers on upgrade and keeps the rest", async () => {
  const options = {
    name: "learning-removal",
    indexedDB: new IDBFactory(),
    keyRange: IDBKeyRange,
    channel: null,
  };
  const old = await openDb({ ...options, schema: appMigrations.slice(0, 4) });
  const row = (scope: string, type: string, id: string) => ({
    scope,
    type,
    id,
    rev: 1,
    deleted: false,
    data: {},
  });
  for (const value of [
    row("learn", "learningCorpus", "corpus"),
    row("me:alice", "learningProgress", "word"),
    row("me:alice", "setting", "learning.discipline"),
    row("me:alice", "setting", "theme"),
  ])
    await old.table("rows").put(value);
  await old.table("scopes").put({ scope: "learn", cursor: 3 });
  await old.table("scopes").put({ scope: "me:alice", cursor: 3 });
  const kept = { op: "b", method: "chat.post.send", args: {} };
  await old
    .table("outbox")
    .put(
      [{ op: "a", method: "learning.answer.record", args: {} }, kept],
      "alice",
    );
  old.close();
  const db = await openAppDb(options);
  try {
    expect(
      (await db.table<{ id: string }>("rows").range()).map((r) => r.id),
    ).toEqual(["theme"]);
    expect(await db.table("scopes").get("learn")).toBeUndefined();
    expect(await db.table("scopes").get("me:alice")).toBeDefined();
    expect(await db.table("outbox").get("alice")).toEqual([kept]);
  } finally {
    db.close();
  }
});
