import { describe, expect, it } from "vitest";
import { createMemoryObjectStore } from "@talos/objectstore";
import { createUlid, sha256Hex } from "@talos/base";
import { Db } from "../persistence/db.ts";
import { Uow } from "../persistence/uow.ts";
import { ObjectLedger } from "./objects.ts";
import { UploadService } from "./uploads.ts";

function fixture() {
  let now = 1000;
  const clock = () => now;
  const db = new Db();
  const uow = new Uow(db, { committed() {} });
  const store = createMemoryObjectStore({ clock });
  const ledger = new ObjectLedger({ db, uow, store, clock, graceMs: 100 });
  const uploads = new UploadService({
    db,
    uow,
    store,
    ledger,
    clock,
    id: createUlid({ clock }),
    stageTtlMs: 200,
    refTtlMs: 200,
  });
  return {
    db,
    uow,
    store,
    ledger,
    uploads,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
describe("object ledger", () => {
  it("requires a Uow, preserves references on rollback, and sweeps only after grace", async () => {
    const f = fixture();
    try {
      const object = await f.store.put(Uint8Array.of(1));
      expect(() => f.ledger.register(object)).toThrowError(/事务/);
      f.uow.write(() => {
        f.ledger.register(object);
        f.ledger.addRef(object.id, "doc", "one");
      });
      expect(() =>
        f.uow.write(() => {
          f.ledger.removeRef(object.id, "doc", "one");
          throw new Error("rollback");
        }),
      ).toThrow();
      f.advance(200);
      expect(await f.ledger.sweep()).toBe(0);
      f.uow.write(() => f.ledger.removeRef(object.id, "doc", "one"));
      expect(await f.ledger.sweep()).toBe(0);
      f.advance(100);
      expect(await f.ledger.sweep()).toBe(1);
      expect(await f.store.has(object.id)).toBe(false);
    } finally {
      f.db.close();
    }
  });
  it("serializes publication and GC so a deduplicated object cannot disappear before retention", async () => {
    const f = fixture();
    try {
      const bytes = Uint8Array.of(42);
      const object = await f.store.put(bytes);
      f.uow.write(() => f.ledger.register(object));
      f.advance(100);
      const sweeping = f.ledger.sweep();
      const publishing = f.ledger.publish(
        () => f.store.put(bytes),
        (info) => f.ledger.addRef(info.id, "doc", "new"),
      );
      expect(await sweeping).toBe(1);
      expect(await publishing).toEqual(object);
      expect(await f.store.has(object.id)).toBe(true);
      expect(f.db.all("SELECT * FROM object_refs")).toHaveLength(1);
    } finally {
      f.db.close();
    }
  });
  it("rejects invalid retention configuration", () => {
    const f = fixture();
    try {
      expect(() => new ObjectLedger({ ...f, graceMs: -1 })).toThrow();
      expect(() => new UploadService({ ...f, stageTtlMs: 0 })).toThrow();
      expect(
        () => new UploadService({ ...f, limits: { file: NaN } }),
      ).toThrow();
    } finally {
      f.db.close();
    }
  });
  it("imports orphans and reports missing objects without deleting ownership", async () => {
    const f = fixture();
    try {
      const orphan = await f.store.put(Uint8Array.of(2));
      const missing = await f.store.put(Uint8Array.of(3));
      f.uow.write(() => {
        f.ledger.register(missing);
        f.ledger.addRef(missing.id, "doc", "one");
      });
      await f.store.delete(missing.id);
      expect(await f.ledger.fsck()).toEqual({
        imported: [orphan.id],
        missing: [missing.id],
        corrupt: [],
      });
      expect(f.db.all("SELECT * FROM object_refs")).toHaveLength(1);
    } finally {
      f.db.close();
    }
  });
  it("reserves objects against concurrent new references and releases reservation on delete failure", async () => {
    const f = fixture();
    try {
      const object = await f.store.put(Uint8Array.of(4));
      f.uow.write(() => f.ledger.register(object));
      f.advance(100);
      f.store.delete = async () => {
        expect(() =>
          f.uow.write(() => f.ledger.addRef(object.id, "doc", "late")),
        ).toThrowError(/清理/);
        throw new Error("busy");
      };
      await expect(f.ledger.sweep()).rejects.toThrow("busy");
      expect(() =>
        f.uow.write(() => f.ledger.addRef(object.id, "doc", "retry")),
      ).not.toThrow();
    } finally {
      f.db.close();
    }
  });
});
describe("resumable uploads", () => {
  it("resumes, verifies, commits idempotently and atomically claims a temporary ref", async () => {
    const f = fixture();
    try {
      const bytes = Uint8Array.of(1, 2, 3, 4);
      const args = {
        kind: "file" as const,
        size: bytes.length,
        sha256: sha256Hex(bytes),
      };
      const begin = await f.uploads.begin("user", args);
      await f.uploads.append(
        "user",
        { id: begin.id, offset: 0 },
        bytes.subarray(0, 2),
      );
      expect(await f.uploads.begin("user", { ...args, id: begin.id })).toEqual({
        id: begin.id,
        offset: 2,
      });
      await expect(
        f.uploads.append(
          "user",
          { id: begin.id, offset: 0 },
          bytes.subarray(0, 2),
        ),
      ).rejects.toMatchObject({ code: "E_CONFLICT" });
      await expect(f.uploads.commit("user", begin)).rejects.toMatchObject({
        code: "E_INTEGRITY",
      });
      await f.uploads.append(
        "user",
        { id: begin.id, offset: 2 },
        bytes.subarray(2),
      );
      const committed = await f.uploads.commit("user", begin);
      expect(await f.uploads.commit("user", begin)).toEqual(committed);
      expect(() =>
        f.uploads.claim("user", begin.id, "doc", "doc-one"),
      ).toThrow();
      f.uow.write(() => f.uploads.claim("user", begin.id, "doc", "doc-one"));
      expect(f.db.all("SELECT owner_kind,owner_id FROM object_refs")).toEqual([
        { owner_kind: "doc", owner_id: "doc-one" },
      ]);
      f.advance(1000);
      expect(await f.ledger.sweep()).toBe(0);
    } finally {
      f.db.close();
    }
  });
  it("checks ownership, immutable declarations, chunk size, kind limits, and hash", async () => {
    const f = fixture();
    try {
      const begin = await f.uploads.begin("u", {
        kind: "file",
        size: 2,
        sha256: "0".repeat(64),
      });
      await expect(
        f.uploads.begin("other", { id: begin.id, kind: "file", size: 2 }),
      ).rejects.toMatchObject({ code: "E_DENIED" });
      await expect(
        f.uploads.begin("u", { id: begin.id, kind: "file", size: 3 }),
      ).rejects.toMatchObject({ code: "E_CONFLICT" });
      await expect(
        f.uploads.append("u", { id: begin.id, offset: 0 }, new Uint8Array(3)),
      ).rejects.toMatchObject({ code: "E_TOO_LARGE" });
      await expect(
        f.uploads.begin("u", { kind: "image", size: 100_000_000 }),
      ).rejects.toMatchObject({ code: "E_TOO_LARGE" });
      await f.uploads.append(
        "u",
        { id: begin.id, offset: 0 },
        Uint8Array.of(1, 2),
      );
      await expect(f.uploads.commit("u", begin)).rejects.toMatchObject({
        code: "E_INTEGRITY",
      });
      await expect(f.uploads.abort("other", begin)).rejects.toMatchObject({
        code: "E_DENIED",
      });
      expect(await f.uploads.abort("u", begin)).toEqual({ ok: true });
      expect(await f.uploads.abort("u", begin)).toEqual({ ok: true });
    } finally {
      f.db.close();
    }
  });
  it("expires abandoned stages and temporary refs; refreshed resumes survive sweep", async () => {
    const f = fixture();
    try {
      const stale = await f.uploads.begin("u", { kind: "file", size: 1 });
      const committed = await f.uploads.begin("u", { kind: "file", size: 0 });
      const object = await f.uploads.commit("u", committed);
      f.advance(150);
      await f.uploads.begin("u", { id: stale.id, kind: "file", size: 1 });
      f.advance(51);
      expect(await f.uploads.sweep()).toBe(1);
      expect(
        await f.uploads.append(
          "u",
          { id: stale.id, offset: 0 },
          Uint8Array.of(5),
        ),
      ).toEqual({ offset: 1 });
      f.advance(100);
      expect(await f.ledger.sweep()).toBe(1);
      expect(await f.store.has(object.object.id)).toBe(false);
    } finally {
      f.db.close();
    }
  });
});
