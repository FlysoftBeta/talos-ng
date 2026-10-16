import { describe, expect, it, vi } from "vitest";
import { FilesController } from "./controller.ts";
import type { FilesControllerPorts } from "./controller.ts";

/** In-memory file store with the owner-lease semantics the controller relies on. */
function memoryFiles() {
  const bytes = new Map<string, Uint8Array>();
  const owners = new Map<string, Set<string>>();
  const writers: Array<{ closed: boolean }> = [];
  return {
    bytes,
    owners,
    writers,
    store: {
      has: vi.fn(async (rid: string) => bytes.has(rid)),
      owners: vi.fn(async (rid: string) => [...(owners.get(rid) ?? [])]),
      read: vi.fn(
        async (rid: string, range?: { start: number; end: number }) => {
          const all = bytes.get(rid)!;
          return (range ? all.slice(range.start, range.end) : all).buffer.slice(
            0,
          ) as ArrayBuffer;
        },
      ),
      begin: vi.fn(async (rid: string, size: number) => {
        const state = { closed: false };
        writers.push(state);
        let written = 0;
        return {
          get written() {
            return written;
          },
          append: async (chunk: ArrayBuffer | Uint8Array) => {
            written += chunk.byteLength;
          },
          commit: async () => void bytes.set(rid, new Uint8Array(size)),
          close: async () => void (state.closed = true),
        };
      }),
      retain: vi.fn(async (owner: string, rid: string) => {
        owners.set(rid, (owners.get(rid) ?? new Set()).add(owner));
      }),
      releaseOwner: vi.fn(async (owner: string) => {
        for (const set of owners.values()) set.delete(owner);
      }),
      put: vi.fn(
        async (rid: string, data: Uint8Array) => void bytes.set(rid, data),
      ),
      gc: vi.fn(async () => {}),
      listByOwnerPrefix: vi.fn(async () => []),
    },
  };
}

function setup(partial: Partial<FilesControllerPorts> = {}) {
  const files = memoryFiles();
  const kv = new Map<string, unknown>();
  const status = vi.fn();
  const ports = {
    files: files.store,
    saved: { user: { id: "u1" } },
    generation: 1,
    closed: false,
    storageFull: false,
    hasScope: () => true,
    status,
    environment: {
      downloadUrl: (u: string) => `http://h${u}`,
      fetch: vi.fn(),
    },
    db: {
      table: () => ({
        get: async (k: string) => kv.get(k),
        put: async (v: unknown, k: string) => void kv.set(k, v),
        delete: async (k: string) => void kv.delete(k),
      }),
    },
    eviction: {
      touch: vi.fn(),
      makeRoom: vi.fn(async () => {}),
      track: vi.fn(async () => {}),
    },
    ...partial,
  } as unknown as FilesControllerPorts;
  return { controller: new FilesController(ports), ports, files, kv, status };
}

describe("per-user file visibility", () => {
  it("hides a complete file that only another user owns", async () => {
    const t = setup();
    t.files.bytes.set("r", new Uint8Array([1]));
    t.files.owners.set("r", new Set(["u2:doc"]));
    expect(await t.controller.hasFile("r")).toBe(false);
    expect(await t.controller.readFile("r")).toBeUndefined();
    expect(await t.controller.readFileRange("r", 0, 1)).toBeUndefined();
    t.files.owners.get("r")!.add("u1:doc");
    expect(await t.controller.hasFile("r")).toBe(true);
    expect([...(await t.controller.readFile("r"))!]).toEqual([1]);
    expect(t.ports.eviction!.touch).toHaveBeenCalledWith("r");
  });

  it("returns nothing when the session changes while bytes are read", async () => {
    const t = setup();
    t.files.bytes.set("r", new Uint8Array([1, 2]));
    t.files.owners.set("r", new Set(["u1:doc"]));
    t.files.store.read.mockImplementationOnce(async () => {
      (t.ports as { saved: unknown }).saved = { user: { id: "u2" } };
      return new Uint8Array([1, 2]).buffer;
    });
    expect(await t.controller.readFile("r")).toBeUndefined();
    (t.ports as { saved: unknown }).saved = { user: { id: "u1" } };
    t.files.store.read.mockImplementationOnce(async () => {
      (t.ports as { generation: number }).generation = 2;
      return new Uint8Array([1]).buffer;
    });
    expect(await t.controller.readFileRange("r", 0, 1)).toBeUndefined();
  });

  it("is empty without storage or a session, and demands login to write", async () => {
    const t = setup({ files: undefined, saved: undefined });
    expect(await t.controller.readFile("r")).toBeUndefined();
    expect(await t.controller.hasFile("r")).toBe(false);
    await expect(
      t.controller.saveFile("r", new Uint8Array(), "o"),
    ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
    await expect(t.controller.retainFile("r", "o")).rejects.toMatchObject({
      code: "E_UNAUTHENTICATED",
    });
    await expect(
      t.controller.downloadFile("r", 1, "/u", "o"),
    ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
    await expect(t.controller.setLocal("k", 1)).rejects.toMatchObject({
      code: "E_UNAUTHENTICATED",
    });
    expect(await t.controller.getLocal("k")).toBeUndefined();
    await t.controller.releaseFiles("o");
    await t.controller.collectFiles();
  });
});

describe("saving, retaining and revocation races", () => {
  it("makes room, stores and leases the file to user:owner", async () => {
    const t = setup();
    await t.controller.saveFile("r", new Uint8Array([7, 7, 7]), "doc:1");
    expect(t.ports.eviction!.makeRoom).toHaveBeenCalledWith(3);
    expect(t.files.owners.get("r")).toEqual(new Set(["u1:doc:1"]));
  });

  it("releases the lease when scope access is revoked right after the write", async () => {
    let allowed = true;
    const t = setup({ hasScope: () => allowed });
    t.files.store.retain.mockImplementationOnce(async (owner, rid) => {
      t.files.owners.set(rid, new Set([owner]));
      allowed = false;
    });
    await expect(
      t.controller.saveFile("r", new Uint8Array([1]), "conv:c1:doc"),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    expect(t.files.store.releaseOwner).toHaveBeenCalledWith("u1:conv:c1:doc");
    expect(t.files.owners.get("r")?.size ?? 0).toBe(0);
  });

  it.each(["save", "retain"] as const)(
    "removes only the old user's lease when %s crosses an account switch",
    async (operation) => {
      const t = setup();
      t.files.owners.set("r", new Set(["u2:doc"]));
      t.files.store.retain.mockImplementationOnce(async (owner, rid) => {
        t.files.owners.get(rid)!.add(owner);
        (t.ports as { saved: unknown }).saved = { user: { id: "u2" } };
      });
      await expect(
        operation === "save"
          ? t.controller.saveFile("r", new Uint8Array([1]), "doc")
          : t.controller.retainFile("r", "doc"),
      ).rejects.toMatchObject({ code: "E_CANCELLED" });
      expect(t.files.owners.get("r")).toEqual(new Set(["u2:doc"]));
    },
  );

  it("does not write bytes when room-making crosses a session change", async () => {
    const t = setup();
    t.ports.eviction!.makeRoom = vi.fn(async () => {
      t.ports.generation++;
    });
    await expect(
      t.controller.saveFile("r", new Uint8Array([1]), "doc"),
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(t.files.store.put).not.toHaveBeenCalled();
    expect(t.files.store.retain).not.toHaveBeenCalled();
  });

  it("rejects a save finished by a different user without leasing", async () => {
    const t = setup();
    t.files.store.put.mockImplementationOnce(async () => {
      (t.ports as { saved: unknown }).saved = { user: { id: "u2" } };
    });
    await expect(
      t.controller.saveFile("r", new Uint8Array([1]), "doc"),
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(t.files.store.retain).not.toHaveBeenCalled();
  });

  it("retainFile releases the lease if the scope disappears mid-call", async () => {
    let calls = 0;
    const t = setup({ hasScope: () => ++calls < 2 });
    await expect(
      t.controller.retainFile("r", "coll:c:x"),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    expect(t.files.store.releaseOwner).toHaveBeenCalledOnce();
  });
});

describe("download lifecycle", () => {
  it("cancels a download requested by a previous session generation", async () => {
    const t = setup();
    (t.ports as { generation: number }).generation = 2;
    const controller = t.controller;
    // generation is captured at call time: bump it inside the first awaited step
    t.ports.eviction!.makeRoom = vi.fn(async () => {
      (t.ports as { generation: number }).generation = 3;
    });
    const fetchSpy = t.ports.environment.fetch as ReturnType<typeof vi.fn>;
    await expect(
      controller.downloadFile("r", 10, "/f", "doc"),
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(t.files.writers.every((w) => w.closed)).toBe(true);
  });

  it("refuses an invalid size before writing and always closes the writer", async () => {
    const t = setup();
    await expect(
      t.controller.downloadFile("r", -1, "/f", "doc"),
    ).rejects.toMatchObject({ code: "E_INVALID" });
    expect(t.files.writers).toHaveLength(1);
    expect(t.files.writers[0]!.closed).toBe(true);
    expect(t.files.store.retain).not.toHaveBeenCalled();
  });

  it("does not lease a file whose session ended during the final range", async () => {
    const t = setup();
    // zero-byte download needs no range request: assertActive runs after retain
    t.files.store.retain.mockImplementationOnce(
      async (owner: string, rid: string) => {
        t.files.owners.set(rid, new Set([owner]));
        (t.ports as { closed: boolean }).closed = true;
      },
    );
    await expect(
      t.controller.downloadFile("r", 0, "/f", "doc"),
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(t.files.store.releaseOwner).toHaveBeenCalledWith("u1:doc");
    expect(t.files.writers[0]!.closed).toBe(true);
  });
});

describe("feature key/value scope", () => {
  it("namespaces values per user and tracks them for eviction", async () => {
    const t = setup();
    await t.controller.setLocal("pref", { a: 1 });
    expect(t.kv.get("feature:u1:pref")).toEqual({ a: 1 });
    expect(t.ports.eviction!.track).toHaveBeenCalledWith("feature:u1:pref", {
      a: 1,
    });
    expect(await t.controller.getLocal("pref")).toEqual({ a: 1 });
    (t.ports as { saved: unknown }).saved = { user: { id: "u2" } };
    expect(await t.controller.getLocal("pref")).toBeUndefined();
  });

  it("removes a written value when its scope is revoked during the write", async () => {
    let allowed = true;
    const t = setup({ hasScope: () => allowed });
    t.ports.db!.table = (() => ({
      put: async (value: unknown, key: string) => {
        t.kv.set(key, value);
        allowed = false;
      },
      delete: async (key: string) => {
        t.kv.delete(key);
      },
    })) as never;
    await expect(
      t.controller.setLocal("conv:c:draft", "x"),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    expect(t.kv.has("feature:u1:conv:c:draft")).toBe(false);
  });

  it("does not persist retention metadata after a session change while making room", async () => {
    const t = setup();
    t.ports.eviction!.makeRoom = vi.fn(async () => {
      t.ports.generation++;
    });
    await expect(
      t.controller.setLocal("media:retained", [{ track: "t" }]),
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(t.kv.size).toBe(0);
  });

  it.each(["library", "media"])(
    "checks current access for personal %s retention owners",
    (area) => {
      const rows = [
        {
          scope: "coll:one",
          type: area === "library" ? "libraryDoc" : "mediaTrack",
          id: "item",
          deleted: false,
        },
      ];
      let admitted = true;
      const t = setup({
        engine: { getSnapshot: () => ({ rows }) } as never,
        hasScope: () => admitted,
      });
      expect(() =>
        t.controller.assertLocalScope(`${area}:item:retained`),
      ).not.toThrow();
      admitted = false;
      expect(() =>
        t.controller.assertLocalScope(`${area}:item:retained`),
      ).toThrow(expect.objectContaining({ code: "E_DENIED" }));
      admitted = true;
      rows[0]!.deleted = true;
      expect(() =>
        t.controller.assertLocalScope(`${area}:item:retained`),
      ).toThrow(expect.objectContaining({ code: "E_DENIED" }));
    },
  );

  it("denies reads and writes for revoked conversation or collection scopes", async () => {
    const t = setup({ hasScope: (s: string) => s !== "coll:gone" });
    await expect(t.controller.getLocal("coll:gone:x")).rejects.toMatchObject({
      code: "E_DENIED",
    });
    await expect(t.controller.setLocal("coll:gone:x", 1)).rejects.toMatchObject(
      { code: "E_DENIED" },
    );
    await expect(t.controller.getLocal("coll:ok:x")).resolves.toBeUndefined();
  });

  it("allows a media key only while the playlist still lists the track", () => {
    const T1 = "01ARZ3NDEKTSV4RRFFQ69G5FA0",
      T2 = "01ARZ3NDEKTSV4RRFFQ69G5FA1";
    const rows = [
      {
        scope: "coll:c",
        type: "mediaPlaylist",
        deleted: false,
        data: {
          id: T1,
          owner: T1,
          title: "list",
          tracks: [T1],
          created: 1,
        },
      },
    ];
    const t = setup({ engine: { getSnapshot: () => ({ rows }) } as never });
    expect(() =>
      t.controller.assertLocalScope(`coll:c:media:${T1}`),
    ).not.toThrow();
    expect(() => t.controller.assertLocalScope(`coll:c:media:${T2}`)).toThrow(
      expect.objectContaining({ code: "E_DENIED" }),
    );
    rows[0]!.deleted = true;
    expect(() => t.controller.assertLocalScope(`coll:c:media:${T1}`)).toThrow(
      expect.objectContaining({ code: "E_DENIED" }),
    );
    expect(() => t.controller.assertLocalScope("plain-key")).not.toThrow();
  });
});

describe("storage estimate", () => {
  it("reports full, unsupported, measured and failing estimates", async () => {
    const full = setup({ storageFull: true });
    await full.controller.estimateStorage();
    expect(full.status).toHaveBeenLastCalledWith({ storage: "存储空间不足" });
    const none = setup();
    await none.controller.estimateStorage();
    expect(none.status).toHaveBeenLastCalledWith({
      storage: "此浏览器不支持存储估算",
    });
    const ok = setup();
    ok.ports.environment.estimate = async () => ({
      usage: 3 * 1048576,
      quota: 100 * 1048576,
    });
    await ok.controller.estimateStorage();
    expect(ok.status).toHaveBeenLastCalledWith({ storage: "3.0 MB / 100 MB" });
    ok.ports.environment.estimate = async () => {
      throw new Error("denied");
    };
    await ok.controller.estimateStorage();
    expect(ok.status).toHaveBeenLastCalledWith({ storage: "暂时无法估算" });
  });
});
