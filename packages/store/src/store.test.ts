import { test } from "vitest";
import { AppError, sha256Hex } from "@talos/base";
import { forceCloseDatabase } from "fake-indexeddb";
import { createTestEnvironment } from "./testing/environment.ts";
import {
  openDb,
  createFileStores,
  FileStore,
  CHUNK_SIZE,
  KV,
  guardValue,
  storageError,
} from "./index.ts";
import type { Database, DbOptions, Migration, Transaction } from "./index.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(a: unknown, b: unknown): void {
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    `${JSON.stringify(a)} != ${JSON.stringify(b)}`,
  );
}
async function rejects(fn: () => unknown, code: string): Promise<AppError> {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof AppError, String(error));
    equal(error.code, code);
    return error;
  }
  throw new Error(`Expected ${code}`);
}
const schema: Migration[] = [
  {
    version: 1,
    upgrade: (tx) => {
      tx.db
        .createObjectStore("rows", { keyPath: "id" })
        .createIndex("group", "group");
      tx.db.createObjectStore("other");
      tx.db.createObjectStore("kv");
      createFileStores(tx);
    },
  },
];
let sequence = 0;
function fixture() {
  const fake = createTestEnvironment();
  const native = typeof window !== "undefined";
  const factory = native ? indexedDB : fake.indexedDB;
  const keyRange = native ? IDBKeyRange : fake.keyRange;
  const name = `talos-store-test-${Date.now()}-${++sequence}`;
  const connections: Database[] = [];
  return {
    native,
    factory,
    name,
    keyRange,
    async open(options: Partial<DbOptions> = {}): Promise<Database> {
      const db = await openDb({
        name,
        schema,
        indexedDB: factory,
        keyRange,
        channel: null,
        ...options,
      });
      connections.push(db);
      return db;
    },
    async clean(): Promise<void> {
      for (const db of connections) db.close();
      await new Promise<void>((resolve, reject) => {
        const r = factory.deleteDatabase(name);
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
      });
    },
  };
}
function scenario(
  name: string,
  body: (f: ReturnType<typeof fixture>) => Promise<void>,
): void {
  // Multi-MiB hashing + chunk round trips are CPU-bound; under coverage or a
  // loaded host they exceed the 5 s default, so the budget is explicit.
  test(
    name,
    async () => {
      const f = fixture();
      try {
        await body(f);
      } finally {
        await f.clean();
      }
    },
    30_000,
  );
}
function bytes(size: number): Uint8Array {
  const value = new Uint8Array(size);
  for (let i = 0; i < size; i++) value[i] = (i * 31 + 7) % 251;
  return value;
}

scenario(
  "migrations v1 to v3 retain data and add compound indexes",
  async (f) => {
    const v1 = await f.open();
    await v1.table("rows").put({ id: "a", group: "g" });
    v1.close();
    const db = await f.open({
      schema: [
        ...schema,
        {
          version: 2,
          upgrade: (tx) =>
            tx.objectStore("rows").createIndex("pair", ["group", "id"]),
        },
        {
          version: 3,
          upgrade: (tx) => {
            tx.objectStore("rows").put({ id: "b", group: "g" });
          },
        },
      ],
    });
    equal(await db.table("rows").byIndex("pair").get(["g", "a"]), {
      id: "a",
      group: "g",
    });
    equal(await db.table("rows").count(), 2);
  },
);
scenario("failed upgrade rolls back schema and data", async (f) => {
  const db = await f.open();
  db.close();
  await rejects(
    () =>
      f.open({
        schema: [
          ...schema,
          {
            version: 2,
            upgrade: (tx) => {
              tx.objectStore("rows").put({ id: "bad" });
              throw new AppError("E_INVALID", "bad upgrade");
            },
          },
        ],
      }),
    "E_INVALID",
  );
  const reopened = await f.open();
  equal(await reopened.table("rows").count(), 0);
});
scenario(
  "blocked upgrade times out and never performs late migration",
  async (f) => {
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = f.factory.open(f.name, 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    let blocked = 0;
    let upgraded = false;
    try {
      await rejects(
        () =>
          f.open({
            schema: [
              {
                version: 2,
                upgrade: () => {
                  upgraded = true;
                },
              },
            ],
            onBlocked: () => {
              blocked++;
            },
            timers: {
              set: (fn) => {
                void Promise.resolve().then(fn);
                return 1;
              },
              clear: () => undefined,
            },
          }),
        "E_BUSY",
      );
    } finally {
      raw.close();
    }
    equal(blocked, 1);
    // A subsequent open queues behind the timed-out request and proves its upgrade was aborted.
    const raw2 = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = f.factory.open(f.name, 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    raw2.close();
    equal(upgraded, false);
  },
);
scenario("versionchange closes stale handles and notifies", async (f) => {
  let version: number | null = 0;
  const old = await f.open({
    onVersionChange: (v) => {
      version = v;
    },
  });
  await f.open({
    schema: [...schema, { version: 2, upgrade: () => undefined }],
  });
  equal(version, 2);
  await rejects(() => old.table("rows").count(), "E_VERSION");
});
scenario("unexpected close lazily reconnects", async (f) => {
  const db = await f.open();
  const raw = await db.connect();
  if (f.native) {
    raw.close();
    raw.dispatchEvent(new Event("close"));
  } else (forceCloseDatabase as unknown as (db: IDBDatabase) => void)(raw);
  await db.table("rows").put({ id: 1 });
  equal(await db.table("rows").count(), 1);
});
scenario(
  "shared transactions chain IDB operations and roll back all stores",
  async (f) => {
    const db = await f.open();
    await db.tx(["rows", "other"], "readwrite", (tx) =>
      tx
        .table<{ id: number }>("rows")
        .put({ id: 1 })
        .then(() => tx.table("other").put("ok", "key")),
    );
    await rejects(
      () =>
        db.tx(["rows", "other"], "readwrite", (tx) => {
          tx.table("rows").put({ id: 2 });
          tx.table("other").put("bad", "key");
          tx.abort();
        }),
      "E_CANCELLED",
    );
    equal(await db.table("rows").count(), 1);
    equal(await db.table("other").get("key"), "ok");
  },
);
scenario(
  "request errors abort earlier writes and map constraints",
  async (f) => {
    const db = await f.open();
    await rejects(
      () =>
        db.tx(["rows", "other"], "readwrite", (tx) => {
          tx.table("other").put("must roll back", "x");
          return tx.table("rows").put({ noId: true });
        }),
      "E_INVALID",
    );
    equal(await db.table("other").count(), 0);
  },
);
scenario(
  "async callbacks and foreign promises reject without partial commits",
  async (f) => {
    const db = await f.open();
    await rejects(
      () =>
        db.tx(["rows"], "readwrite", async (tx) => {
          tx.table("rows").put({ id: 1 });
          await Promise.resolve();
        }),
      "E_INVALID",
    );
    await rejects(
      () =>
        db.tx(["rows"], "readwrite", (tx) =>
          tx
            .table("rows")
            .put({ id: 2 })
            .then(() => Promise.resolve("bad")),
        ),
      "E_INVALID",
    );
    equal(await db.table("rows").count(), 0);
  },
);
scenario("expired transaction handles clearly reject", async (f) => {
  const db = await f.open();
  let saved!: Transaction;
  await db.tx(["rows"], "readonly", (tx) => {
    saved = tx;
  });
  await rejects(() => saved.table("rows"), "E_INVALID");
});
scenario(
  "table bulk, bounded reverse cursors, compound keys and indexes",
  async (f) => {
    const db = await f.open();
    const table = db.table<{ id: number; group: string }, number>("rows");
    await table.putMany(
      Array.from({ length: 10 }, (_, id) => ({
        id,
        group: id % 2 ? "odd" : "even",
      })),
    );
    equal(await table.getMany([1, 99, 0]), [
      { id: 1, group: "odd" },
      undefined,
      { id: 0, group: "even" },
    ]);
    equal(
      (
        await table.range({
          lower: 2,
          upper: 7,
          lowerOpen: true,
          reverse: true,
          limit: 3,
        })
      ).map((v) => v.id),
      [7, 6, 5],
    );
    equal(
      await table
        .byIndex<string>("group")
        .count({ lower: "even", upper: "even" }),
      5,
    );
    equal(await table.range({ limit: 0 }), []);
    await table.deleteRange({ lower: 3, upper: 7, upperOpen: true });
    equal(await table.count(), 6);
    await table.delete(9);
    equal(await table.count(), 5);
    await table.clear();
    equal(await table.count(), 0);
  },
);
scenario("randomized table range invariants", async (f) => {
  const db = await f.open();
  const table = db.table<{ id: number }, number>("rows");
  await table.putMany(Array.from({ length: 80 }, (_, id) => ({ id })));
  let seed = 9127;
  for (let i = 0; i < 40; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const lower = seed % 80;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const upper = lower + (seed % (81 - lower));
    const result = await table.range({ lower, upper, upperOpen: true });
    equal(
      result.map((v) => v.id),
      Array.from({ length: upper - lower }, (_, n) => lower + n),
    );
  }
});
scenario(
  "deep no-Blob guard, cycles, maps, functions and DOM ducks",
  async (f) => {
    const db = await f.open();
    const blobDuck = { size: 1, type: "text/plain", slice: () => undefined };
    for (const bad of [
      blobDuck,
      { nodeType: 1, nodeName: "DIV" },
      () => undefined,
      new Map([["x", blobDuck]]),
    ])
      await rejects(
        () => db.table("other").put({ deep: [{ bad }] }, "x"),
        "E_INVALID",
      );
    // Real Blob obtained through a platform response, without importing forbidden storage types.
    const real = await new Response("x").blob();
    await rejects(
      () => db.table("other").put({ deep: [real] }, "x"),
      "E_INVALID",
    );
    const cyclic: { self?: unknown; bytes: ArrayBuffer } = {
      bytes: new ArrayBuffer(2),
    };
    cyclic.self = cyclic;
    guardValue(cyclic);
    await db.table("other").put(cyclic, "cycle");
    equal(await db.table("other").count(), 1);
  },
);
scenario(
  "notifications coalesce after commit and skip aborted writes",
  async (f) => {
    const db = await f.open();
    const events: unknown[] = [];
    const off = db.subscribe(["rows", "other"], (e) => events.push(e.tables));
    await db.tx(["rows", "other"], "readwrite", (tx) => {
      tx.table("rows").put({ id: 1 });
      tx.table("rows").put({ id: 2 });
      tx.table("other").put(3, "x");
    });
    equal(events, [["rows", "other"]]);
    await rejects(
      () =>
        db.tx(["rows"], "readwrite", (tx) => {
          tx.table("rows").put({ id: 4 });
          tx.abort();
        }),
      "E_CANCELLED",
    );
    equal(events.length, 1);
    off();
    await db.table("rows").clear();
    equal(events.length, 1);
  },
);
scenario(
  "BroadcastChannel delivers to independent connections without echo",
  async (f) => {
    const a = await f.open({ channel: undefined });
    const b = await f.open({ channel: undefined });
    let local = 0;
    a.subscribe(["rows"], () => local++);
    const delivered = new Promise<void>((resolve) => {
      b.subscribe(["rows"], () => resolve());
    });
    await a.table("rows").put({ id: 1 });
    await delivered;
    equal(local, 1);
  },
);
scenario("KV supports JSON and ArrayBuffer and rejects non-JSON", async (f) => {
  const kv = new KV(await f.open());
  await kv.set("json", { a: [1, true, null] });
  equal(await kv.get("json"), { a: [1, true, null] });
  await kv.set("buffer", new Uint8Array([1, 2]).buffer);
  equal(
    Array.from(new Uint8Array((await kv.get<ArrayBuffer>("buffer"))!)),
    [1, 2],
  );
  await rejects(() => kv.set("bad", NaN), "E_INVALID");
  await kv.delete("json");
  equal(await kv.get("json"), undefined);
});
for (const size of [
  0,
  1,
  CHUNK_SIZE - 1,
  CHUNK_SIZE,
  CHUNK_SIZE + 1,
  5.5 * CHUNK_SIZE,
  9 * CHUNK_SIZE,
]) {
  scenario(
    `file round-trip ${size} bytes and incremental chunk iteration`,
    async (f) => {
      const db = await f.open();
      const files = new FileStore(db, { locks: null });
      const data = bytes(size);
      const rid = sha256Hex(data);
      await files.put(rid, data);
      assert(await files.has(rid));
      equal(sha256Hex(new Uint8Array(await files.read(rid))), rid);
      let total = 0;
      for await (const chunk of files.readChunks(rid)) {
        assert(chunk.byteLength <= CHUNK_SIZE);
        total += chunk.byteLength;
      }
      equal(total, size);
      const head = await files.stat(rid);
      equal(head?.chunks, Math.ceil(size / CHUNK_SIZE));
      await files.put(rid, data);
      equal((await files.usage()).files, 1);
    },
  );
}
scenario(
  "resume merges partial chunks and range reads cross boundaries",
  async (f) => {
    const files = new FileStore(await f.open(), { locks: null, subtle: null });
    const data = bytes(2 * CHUNK_SIZE + 17);
    const rid = sha256Hex(data);
    const a = await files.begin(rid, data.length);
    await a.append(data.subarray(0, CHUNK_SIZE - 3));
    await a.close();
    const b = await files.begin(rid, data.length);
    equal(b.written, CHUNK_SIZE - 3);
    await b.append(data.subarray(b.written, b.written + 10));
    await b.append(data.subarray(b.written));
    await b.commit();
    equal(
      Array.from(
        new Uint8Array(
          await files.read(rid, { start: CHUNK_SIZE - 5, end: CHUNK_SIZE + 5 }),
        ),
      ),
      Array.from(data.subarray(CHUNK_SIZE - 5, CHUNK_SIZE + 5)),
    );
    equal(
      (await files.read(rid, { start: data.length, end: data.length }))
        .byteLength,
      0,
    );
    await rejects(() => files.read(rid, { start: 2, end: 1 }), "E_INVALID");
  },
);
scenario("integrity and size failures remove heads and chunks", async (f) => {
  const db = await f.open();
  const files = new FileStore(db, { subtle: null, locks: null });
  const rid = sha256Hex(bytes(3));
  await rejects(() => files.put(rid, bytes(4)), "E_INTEGRITY");
  equal(await files.stat(rid), undefined);
  const writer = await files.begin(rid, 3);
  await writer.append(bytes(1));
  await rejects(() => writer.commit(), "E_INTEGRITY");
  equal(await db.table("file_chunks").count(), 0);
});
scenario("owner retention, prefix accounting, release and GC", async (f) => {
  const db = await f.open();
  const files = new FileStore(db, { locks: null });
  const data = bytes(4);
  const rid = sha256Hex(data);
  await files.put(rid, data);
  await files.retain("doc:a", rid);
  await files.retain("doc:b", rid);
  await files.retain("shell:a", rid);
  await files.retain("doc:a", rid);
  equal((await files.owners(rid)).sort(), ["doc:a", "doc:b", "shell:a"]);
  equal((await files.listByOwnerPrefix("doc:")).length, 2);
  equal(await files.usage(), {
    bytes: 4,
    files: 1,
    byOwnerPrefix: { doc: 4, shell: 4 },
  });
  equal((await files.gc({ incompleteOlderThanMs: 0 })).files, 0);
  await files.releaseOwner("doc:a");
  await files.release("doc:b", rid);
  await files.releaseOwner("shell:a");
  equal(await files.gc({ incompleteOlderThanMs: 0 }), { files: 1, bytes: 4 });
  equal(await files.has(rid), false);
});
scenario(
  "fallback leases protect writers, fence expired handles and reclaim abandoned uploads",
  async (f) => {
    let now = 1000;
    const a = new FileStore(await f.open(), {
      clock: () => now,
      leaseMs: 10,
      locks: null,
    });
    const b = new FileStore(await f.open(), {
      clock: () => now,
      leaseMs: 10,
      locks: null,
    });
    const data = bytes(7);
    const rid = sha256Hex(data);
    const old = await a.begin(rid, 7);
    await old.append(data.subarray(0, 2));
    await rejects(() => b.begin(rid, 7), "E_BUSY");
    equal((await b.gc({ incompleteOlderThanMs: 0 })).files, 0);
    now += 11;
    const resumed = await b.begin(rid, 7);
    equal(resumed.written, 2);
    await rejects(() => old.append(data.subarray(2)), "E_BUSY");
    await old.close();
    await resumed.append(data.subarray(2));
    await resumed.commit();
    assert(await b.has(rid));
    const stale = await a.begin(sha256Hex(bytes(9)), 9);
    await stale.append(bytes(1));
    now += 11;
    equal((await b.gc({ incompleteOlderThanMs: 5 })).files, 2);
  },
);
scenario(
  "GC checks ownership atomically and handles multiple bounded pages",
  async (f) => {
    const db = await f.open();
    const files = new FileStore(db, { locks: null });
    for (let n = 0; n < 35; n++) {
      const data = new Uint8Array([n]);
      await files.put(sha256Hex(data), data);
    }
    equal(await files.gc({ incompleteOlderThanMs: 0 }), {
      files: 35,
      bytes: 35,
    });
    equal(await db.table("file_heads").count(), 0);
    equal(await db.table("file_leases").count(), 0);
  },
);
scenario("quota mapping and injected Web Locks/estimate paths", async (f) => {
  const db = await f.open();
  let locks = 0;
  const files = new FileStore(db, {
    locks: {
      request: async (_name, fn) => {
        locks++;
        return fn();
      },
    },
    estimate: async () => ({ usage: 2, quota: 10 }),
  });
  const data = bytes(1);
  await files.put(sha256Hex(data), data);
  assert(locks > 0);
  equal(await files.estimate(), { usage: 2, quota: 10 });
  const error = await rejects(
    () =>
      db.tx(["rows"], "readwrite", (tx) => {
        tx.table("rows").put({ id: 1 });
        throw new DOMException("full", "QuotaExceededError");
      }),
    "E_TOO_LARGE",
  );
  equal(error.data, { quota: true });
  equal(await db.table("rows").count(), 0);
  equal(
    storageError(new DOMException("inactive", "TransactionInactiveError")).code,
    "E_INVALID",
  );
});
scenario(
  "invalid schema, rid, size, append and incomplete reads fail clearly",
  async (f) => {
    await rejects(() => f.open({ schema: [] }), "E_INVALID");
    await rejects(
      () => f.open({ schema: [schema[0]!, schema[0]!] }),
      "E_INVALID",
    );
    const files = new FileStore(await f.open(), { locks: null });
    await rejects(() => files.begin("bad", 1), "E_INVALID");
    await rejects(() => files.begin("a".repeat(64), -1), "E_INVALID");
    const rid = sha256Hex(bytes(1));
    const writer = await files.begin(rid, 1);
    await rejects(() => writer.append(bytes(2)), "E_INVALID");
    await rejects(() => files.read(rid), "E_NOT_FOUND");
    await writer.close();
  },
);

scenario(
  "empty exclusive ranges are no-ops and invalid limits reject",
  async (f) => {
    const db = await f.open();
    const table = db.table("rows");
    await table.put({ id: 1 });
    equal(await table.count({ lower: 1, upper: 1, upperOpen: true }), 0);
    await table.deleteRange({ lower: 1, upper: 1, lowerOpen: true });
    equal(await table.count(), 1);
    await rejects(() => table.range({ limit: -1 }), "E_INVALID");
  },
);
scenario("unique index request failure rolls back every table", async (f) => {
  const db = await f.open({
    schema: [
      ...schema,
      {
        version: 2,
        upgrade: (tx) => {
          tx.objectStore("rows").createIndex("unique", "unique", {
            unique: true,
          });
        },
      },
    ],
  });
  await rejects(
    () =>
      db.tx(["rows", "other"], "readwrite", (tx) => {
        tx.table("other").put("rolled back", "key");
        tx.table("rows").put({ id: 1, unique: "same" });
        return tx.table("rows").put({ id: 2, unique: "same" });
      }),
    "E_CONFLICT",
  );
  equal(await db.table("rows").count(), 0);
  equal(await db.table("other").count(), 0);
});
scenario(
  "missing chunks fail integrity and clean up all file records",
  async (f) => {
    const db = await f.open();
    const files = new FileStore(db, { locks: null, subtle: null });
    const data = bytes(CHUNK_SIZE + 1);
    const rid = sha256Hex(data);
    const writer = await files.begin(rid, data.length);
    await writer.append(data);
    await db.table("file_chunks").delete([rid, 0]);
    await rejects(() => writer.commit(), "E_INTEGRITY");
    equal(await files.stat(rid), undefined);
    equal(await db.table("file_chunks").count(), 0);
  },
);
scenario(
  "GC deletes chunks in bounded batches and resumes interrupted deletion",
  async (f) => {
    const db = await f.open();
    const rid = "b".repeat(64);
    await db.table("file_heads").put({
      rid,
      size: 65,
      written: 65,
      chunks: 65,
      state: "deleting",
      updatedAt: 0,
    });
    await db.table("file_chunks").putMany(
      Array.from({ length: 65 }, (_, n) => ({
        rid,
        n,
        bytes: new ArrayBuffer(1),
      })),
    );
    let commits = 0;
    db.subscribe(["file_chunks"], () => commits++);
    const files = new FileStore(db, { clock: () => 100, locks: null });
    equal(await files.gc({ incompleteOlderThanMs: 0 }), {
      files: 1,
      bytes: 65,
    });
    equal(commits, 3);
    equal(await db.table("file_chunks").count(), 0);
  },
);
scenario("SHA path uses WebCrypto only for at most 8 MiB", async (f) => {
  let calls = 0;
  const files = new FileStore(await f.open(), {
    locks: null,
    subtle: {
      digest: async (_algorithm, data) => {
        calls++;
        const input =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const hex = sha256Hex(input);
        return new Uint8Array(hex.match(/../g)!.map((v) => parseInt(v, 16)))
          .buffer;
      },
    },
  });
  for (const size of [1, 8 * CHUNK_SIZE, 8 * CHUNK_SIZE + 1]) {
    const data = bytes(size);
    await files.put(sha256Hex(data), data);
  }
  equal(calls, 2);
});
scenario(
  "quota during append leaves the persisted offset retryable",
  async (f) => {
    const db = await f.open();
    const data = bytes(5);
    const rid = sha256Hex(data);
    const files = new FileStore(db, { locks: null });
    const writer = await files.begin(rid, 5);
    // Intercept the native store operation, simulating the platform refusing a chunk write.
    const raw = await db.connect();
    const native = raw
      .transaction(["file_chunks"], "readonly")
      .objectStore("file_chunks");
    const prototype = Object.getPrototypeOf(native) as IDBObjectStore;
    const original = prototype.put;
    prototype.put = function (
      value: unknown,
      key?: IDBValidKey,
    ): IDBRequest<IDBValidKey> {
      if (this.name === "file_chunks")
        throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, value, key);
    };
    try {
      const error = await rejects(() => writer.append(data), "E_TOO_LARGE");
      equal(error.data, { quota: true });
    } finally {
      prototype.put = original;
    }
    equal(writer.written, 0);
    equal((await files.stat(rid))?.written, 0);
    await writer.append(data);
    await writer.commit();
    assert(await files.has(rid));
  },
);

scenario(
  "guard handles cross-realm collections and rejects changing getters",
  async (f) => {
    const db = await f.open();
    const real = await new Response("forbidden").blob();
    let calls = 0;
    const changing = {
      get payload() {
        return ++calls === 1 ? "safe" : real;
      },
    };
    await rejects(() => db.table("other").put(changing, "getter"), "E_INVALID");
    if (f.native) {
      const iframe = document.createElement("iframe");
      document.body.appendChild(iframe);
      try {
        const constructors = iframe.contentWindow as unknown as {
          Map: typeof Map;
          Set: typeof Set;
        };
        const map = new constructors.Map([["nested", real]]);
        const set = new constructors.Set([real]);
        for (const value of [map, set])
          await rejects(
            () => db.table("other").put(value, "foreign"),
            "E_INVALID",
          );
      } finally {
        iframe.remove();
      }
    }
    equal(await db.table("other").count(), 0);
  },
);
