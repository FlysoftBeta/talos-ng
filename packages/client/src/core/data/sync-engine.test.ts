import { afterEach, describe, expect, it } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { AppError, deferred } from "@talos/base";
import { contract } from "@talos/contract";
import type { ArgsOf, CallOptions, Method, ResultOf } from "@talos/contract";
import type { Database } from "@talos/store";
import type { OutboxItem } from "@talos/sync";
import { openAppDb } from "../../platform/storage/database.ts";
import type { StoredRow, StoredScope } from "./db.ts";
import { ModuleRegistry, defineClientModule } from "./modules.ts";
import { SyncEngine } from "./sync-engine.ts";
import type { SyncSnapshot } from "./sync-engine.ts";

import type { TypedCall } from "./link.ts";

type Pull = ResultOf<typeof contract.sync.pull>;
const scope = "me:alice";
const empty = (): Pull => ({ scopes: {}, gone: [], added: [] });
const row = (
  id: string,
  rev: number,
  data: string = id,
  type = "setting",
): Pull["scopes"][string]["rows"][number] => ({
  id,
  rev,
  data,
  type,
  deleted: false,
});
const response = (
  rows: Pull["scopes"][string]["rows"],
  cursor: number,
  extra: Partial<Pull["scopes"][string]> = {},
): Pull => ({
  scopes: { [scope]: { rows, cursor, more: false, ...extra } },
  gone: [],
  added: [],
});
const modules = new ModuleRegistry([
  defineClientModule({
    id: "test",
    rowTypes: ["setting"],
    repositories: {},
    reducers: {
      "me.setting.set": (rows, args, context) => {
        const value = args as { key: string; value: string };
        const target = `me:${context.user}`;
        return [
          ...rows.filter((r) => r.scope !== target || r.id !== value.key),
          {
            scope: target,
            type: "setting",
            id: value.key,
            rev: 0,
            deleted: false,
            data: value.value,
          },
        ];
      },
    },
  }),
]);
const connections: Database[] = [];
const engines: SyncEngine[] = [];
afterEach(() => {
  engines.splice(0).forEach((engine) => engine.close());
  connections.splice(0).forEach((db) => db.close());
});
async function fixture(registry = modules) {
  const indexedDB = new IDBFactory();
  const db = await openAppDb({
    name: "engine",
    indexedDB,
    keyRange: IDBKeyRange,
    channel: null,
  });
  connections.push(db);
  const calls: { name: string; args: unknown; options?: CallOptions }[] = [];
  let handler: (
    name: string,
    args: unknown,
    options?: CallOptions,
  ) => Promise<unknown> = async () => empty();
  const call: TypedCall = async <M extends Method>(
    method: M,
    args: ArgsOf<M>,
    options?: CallOptions,
  ): Promise<ResultOf<M>> => {
    calls.push({ name: method.name, args: structuredClone(args), options });
    return (await handler(method.name, args, options)) as ResultOf<M>;
  };
  let now = 100;
  let nextTimer = 0;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  const make = (user = "alice"): SyncEngine => {
    const engine = new SyncEngine({
      db,
      user,
      modules: registry,
      call,
      now: () => now,
      timers: {
        set: (fn, ms) => {
          const id = ++nextTimer;
          timers.set(id, { fn, ms });
          return id;
        },
        clear: (id) => {
          timers.delete(id as number);
        },
      },
    });
    engines.push(engine);
    return engine;
  };
  const engine = make();
  await engine.hydrate();
  return {
    db,
    engine,
    calls,
    timers,
    make,
    setNow: (value: number) => {
      now = value;
    },
    handle: (fn: typeof handler) => {
      handler = fn;
    },
    fire: () => {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((timer) => timer.fn());
    },
  };
}
const item = (op: string, value = op) => ({
  op,
  method: "me.setting.set",
  args: { key: "theme", value },
  createdAt: 1,
});
function until(
  engine: SyncEngine,
  predicate: (state: SyncSnapshot) => boolean,
): Promise<void> {
  if (predicate(engine.getSnapshot())) return Promise.resolve();
  return new Promise((resolve) => {
    const off = engine.subscribe(() => {
      if (predicate(engine.getSnapshot())) {
        off();
        resolve();
      }
    });
  });
}

describe("durable outbox", () => {
  it("persists queued intent and rebuilds optimistic data after a crash before send", async () => {
    const f = await fixture();
    await f.engine.enqueue(item("one", "dark"));
    expect(f.calls).toEqual([]);
    expect(f.engine.getSnapshot().rows[0]!.data).toBe("dark");
    expect(await f.db.table<StoredRow>("rows").range()).toEqual([]);
    f.engine.close();
    const restored = f.make();
    await restored.hydrate();
    expect(restored.getSnapshot().outbox[0]).toMatchObject({
      op: "one",
      state: "pending",
      attempts: 0,
    });
    expect(restored.getSnapshot().rows[0]!.data).toBe("dark");
  });
  it("recovers persisted sending operations as pending without changing identity", async () => {
    const f = await fixture();
    await f.db
      .table<OutboxItem[], string>("outbox")
      .put([{ ...item("one"), state: "sending", attempts: 2 }], "alice");
    await f.engine.hydrate();
    expect(f.engine.getSnapshot().outbox[0]).toMatchObject({
      op: "one",
      state: "pending",
      attempts: 2,
      error: { code: "E_DISCONNECTED" },
    });
  });
  it("flushes FIFO with original operation IDs and installs authoritative rows before clearing marks", async () => {
    const f = await fixture();
    let accepted = 0;
    f.handle(async (name) =>
      name === "sync.pull"
        ? response(
            accepted ? [row("theme", accepted, `server${accepted}`)] : [],
            accepted,
          )
        : (++accepted, {}),
    );
    await f.engine.enqueue(item("one"));
    await f.engine.enqueue(item("two"));
    const seen: SyncSnapshot[] = [];
    f.engine.subscribe(() => seen.push(f.engine.getSnapshot()));
    await f.engine.connect();
    expect(
      f.calls.filter((c) => c.name !== "sync.pull").map((c) => c.options!.op),
    ).toEqual(["one", "two"]);
    expect(f.engine.getSnapshot().outbox).toEqual([]);
    expect(f.engine.getSnapshot().rows[0]!.data).toBe("server2");
    expect(
      seen
        .filter((s) => !s.outbox.length)
        .every((s) => s.rows[0]?.data === "server2"),
    ).toBe(true);
  });
  it("duplicate and late acknowledgments are idempotent", async () => {
    const f = await fixture();
    await f.engine.enqueue(item("one"));
    await f.engine.ack("one");
    await f.engine.ack("one");
    await f.engine.ack("missing");
    expect(f.engine.getSnapshot().outbox).toEqual([]);
  });
  it.each(["E_DENIED", "E_INVALID", "E_NOT_FOUND", "E_CONFLICT"] as const)(
    "marks %s failed, rolls back optimistic state, and supports retry",
    async (code) => {
      const f = await fixture();
      let reject = true;
      f.handle(async (name) => {
        if (name === "sync.pull")
          return response([row("theme", 1, "server")], 1);
        if (reject) throw new AppError(code, "拒绝");
        return {};
      });
      await f.engine.enqueue(item("one"));
      await f.engine.connect();
      expect(f.engine.getSnapshot().outbox[0]).toMatchObject({
        state: "failed",
        error: { code },
      });
      expect(f.engine.getSnapshot().rows[0]!.data).toBe("server");
      expect(f.calls.filter((c) => c.name === "sync.pull")).toHaveLength(2);
      reject = false;
      await f.engine.retry("one");
      await f.engine.flush();
      expect(f.engine.getSnapshot().outbox).toEqual([]);
    },
  );
  it("failed head blocks ordered writes until discard, which removes only its optimistic effect", async () => {
    const f = await fixture();
    f.handle(async (name, _args, options) => {
      if (name === "sync.pull") return empty();
      if (options!.op === "one") throw new AppError("E_DENIED", "拒绝");
      return {};
    });
    await f.engine.enqueue(item("one"));
    await f.engine.enqueue(item("two"));
    await f.engine.connect();
    expect(f.calls.filter((c) => c.name !== "sync.pull")).toHaveLength(1);
    await f.engine.discard("one");
    await f.engine.flush();
    expect(
      f.calls.filter((c) => c.name !== "sync.pull").map((c) => c.options!.op),
    ).toEqual(["one", "two"]);
    expect(f.engine.getSnapshot().outbox).toEqual([]);
  });
  it("concurrent flushes respect injected retry timer after transport failure", async () => {
    const f = await fixture();
    let attempt = 0;
    f.handle(async (name) => {
      if (name === "sync.pull") return empty();
      if (++attempt === 1) throw new AppError("E_DISCONNECTED", "断开");
      return {};
    });
    await f.engine.enqueue(item("one"));
    await Promise.all([f.engine.connect(), f.engine.flush(), f.engine.flush()]);
    await f.engine.flush();
    expect(attempt).toBe(1);
    expect([...f.timers.values()][0]!.ms).toBe(500);
    expect(f.engine.getSnapshot().outbox[0]!.state).toBe("pending");
    f.fire();
    await until(f.engine, (s) => s.outbox.length === 0);
    expect(attempt).toBe(2);
  });
  it("reconnect mid-flush replays the same operation once and preserves order", async () => {
    const f = await fixture();
    const started = deferred<void>();
    const old = deferred<unknown>();
    let attempts = 0;
    f.handle(async (name) => {
      if (name === "sync.pull") return empty();
      if (++attempts === 1) {
        started.resolve();
        return old.promise;
      }
      return {};
    });
    await f.engine.enqueue(item("one"));
    await f.engine.enqueue(item("two"));
    const initial = f.engine.connect();
    await started.promise;
    f.engine.disconnect();
    const reconnect = f.engine.connect();
    old.reject(new AppError("E_DISCONNECTED", "断开"));
    await Promise.all([initial, reconnect]);
    if (f.engine.getSnapshot().outbox.length) {
      f.fire();
      await until(f.engine, (s) => s.outbox.length === 0);
    }
    expect(
      f.calls.filter((c) => c.name !== "sync.pull").map((c) => c.options!.op),
    ).toEqual(["one", "one", "two"]);
    expect(f.engine.getSnapshot().phase).toBe("live");
  });
  it("disconnect cancels retries and locking does not stop synchronization", async () => {
    const f = await fixture();
    f.handle(async (name) => {
      if (name === "sync.pull") return empty();
      throw new AppError("E_TIMEOUT", "超时");
    });
    await f.engine.enqueue(item("one"));
    await f.engine.connect();
    f.engine.sideState(true, true);
    expect(f.engine.getSnapshot()).toMatchObject({
      phase: "live",
      locked: true,
      updating: true,
    });
    f.engine.disconnect();
    expect(f.timers.size).toBe(0);
    expect(f.engine.getSnapshot().phase).toBe("offline");
  });
  it("rejects missing reducers and duplicate IDs without corrupting the stored outbox", async () => {
    const f = await fixture();
    await expect(
      f.engine.enqueue({ ...item("one"), method: "unknown" }),
    ).rejects.toMatchObject({ code: "E_INVALID" });
    await f.engine.enqueue(item("one"));
    await expect(f.engine.enqueue(item("one"))).rejects.toMatchObject({
      code: "E_CONFLICT",
    });
    expect(f.engine.getSnapshot().outbox).toHaveLength(1);
  });
});

describe("scope synchronization", () => {
  it("buffers multi-scope pages atomically even when completed scopes repeat", async () => {
    const f = await fixture();
    let page = 0;
    f.handle(async () =>
      ++page === 1
        ? {
            scopes: {
              [scope]: { rows: [row("first", 1)], cursor: 1, more: true },
              sys: { rows: [row("public", 1)], cursor: 1, more: false },
            },
            gone: [],
            added: [scope, "sys"],
          }
        : {
            scopes: {
              [scope]: { rows: [row("second", 2)], cursor: 2, more: false },
              sys: { rows: [row("public", 2, "new")], cursor: 2, more: false },
            },
            gone: [],
            added: [],
          },
    );
    const states: number[] = [];
    f.engine.subscribe(() => states.push(f.engine.getSnapshot().rows.length));
    await f.engine.connect();
    expect(f.engine.getSnapshot().rows).toHaveLength(3);
    expect(states.every((count) => count === 0 || count === 3)).toBe(true);
    expect(f.calls[1]!.args).toEqual({ cursors: { [scope]: 1, sys: 1 } });
  });
  it("failed paginated pull commits neither partial rows nor cursor", async () => {
    const f = await fixture();
    let page = 0;
    f.handle(async () => {
      if (++page === 1) return response([row("partial", 1)], 1, { more: true });
      throw new AppError("E_DISCONNECTED", "断开");
    });
    await expect(f.engine.connect()).rejects.toMatchObject({
      code: "E_DISCONNECTED",
    });
    expect(await f.db.table("rows").range()).toEqual([]);
    expect(await f.db.table("scopes").range()).toEqual([]);
  });
  it("disconnected old pull responses cannot commit after a generation change", async () => {
    const f = await fixture();
    const pending = deferred<unknown>();
    const started = deferred<void>();
    f.handle(async () => {
      started.resolve();
      return pending.promise;
    });
    const pull = f.engine.connect();
    await started.promise;
    f.engine.disconnect();
    pending.resolve(response([row("stale", 1)], 1));
    await pull;
    expect(f.engine.getSnapshot().rows).toEqual([]);
    expect(f.engine.getSnapshot().phase).toBe("offline");
  });
  it("tracks in-transaction revisions and preserves tombstones against unordered older rows", async () => {
    const f = await fixture();
    await f.engine.delta(
      response(
        [
          row("theme", 5, "new"),
          row("theme", 2, "old"),
          { ...row("gone", 6), deleted: true, data: null },
          row("gone", 3, "resurrect"),
        ],
        6,
      ),
    );
    expect(
      f.engine.getSnapshot().rows.find((r) => r.id === "theme")!.data,
    ).toBe("new");
    expect(
      f.engine.getSnapshot().rows.find((r) => r.id === "gone")!.deleted,
    ).toBe(true);
  });
  it("resets only named types and keeps newer rows within the reset chain", async () => {
    const f = await fixture();
    await f.engine.delta(
      response([row("old", 1), row("profile", 1, "name", "profile")], 1),
    );
    await f.engine.delta(
      response([row("new", 4, "newer"), row("new", 2, "older")], 4, {
        reset: ["setting"],
      }),
    );
    expect(
      f.engine
        .getSnapshot()
        .rows.map((r) => r.id)
        .sort(),
    ).toEqual(["new", "profile"]);
    expect(f.engine.getSnapshot().rows.find((r) => r.id === "new")!.data).toBe(
      "newer",
    );
  });
  it("gone purges scope data, cursor, and account visibility", async () => {
    const f = await fixture();
    await f.engine.delta(response([row("one", 1)], 1));
    await f.engine.delta({ scopes: {}, gone: [scope], added: [] });
    expect(f.engine.getSnapshot().rows).toEqual([]);
    expect(
      await f.db.table<StoredScope, string>("scopes").get(scope),
    ).toBeUndefined();
    expect(
      await f.db.table<string[], string>("kv").get("scopes:alice"),
    ).toEqual([]);
  });
  it("added event pulls new data and incomplete delta forces a correctness pull", async () => {
    const f = await fixture();
    let pull = 0;
    f.handle(async () => response([row("one", ++pull)], pull));
    await f.engine.connect();
    await f.engine.delta({ scopes: {}, gone: [], added: [scope] });
    await f.engine.delta(response([], 2, { more: true }));
    expect(pull).toBe(3);
    expect(f.engine.getSnapshot().rows[0]!.rev).toBe(3);
  });
  it("stale deltas cannot regress scope cursor or overwrite newer rows", async () => {
    const f = await fixture();
    await f.engine.delta(response([row("one", 9)], 9));
    await f.engine.delta(
      response([row("one", 2, "old")], 2, { reset: ["setting"] }),
    );
    expect(f.engine.getSnapshot().rows[0]!.rev).toBe(9);
    expect(await f.db.table<StoredScope, string>("scopes").get(scope)).toEqual({
      scope,
      cursor: 9,
    });
  });
  it("isolates accounts' hydrated projections, cursor requests, and outboxes", async () => {
    const f = await fixture();
    await f.engine.delta(response([row("secret", 7)], 7));
    await f.engine.enqueue(item("alice-op"));
    const bob = f.make("bob");
    await bob.hydrate();
    expect(bob.getSnapshot().rows).toEqual([]);
    expect(bob.getSnapshot().outbox).toEqual([]);
    await bob.connect();
    expect(f.calls[0]!.args).toEqual({ cursors: {} });
    const alice = f.make();
    await alice.hydrate();
    expect(
      alice
        .getSnapshot()
        .rows.map((r) => r.id)
        .sort(),
    ).toEqual(["secret", "theme"]);
  });
  it("persists injected last-sync clock and restores it after restart", async () => {
    const f = await fixture();
    f.setNow(456);
    await f.engine.delta(response([], 0));
    const restored = f.make();
    await restored.hydrate();
    expect(restored.getSnapshot().lastSync).toBe(456);
  });
});
it("generated unordered histories converge to maximum revision per identity including tombstones", async () => {
  const f = await fixture();
  let random = 53;
  const next = (): number => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return random;
  };
  const expected = new Map<string, Pull["scopes"][string]["rows"][number]>();
  for (let batch = 0; batch < 25; batch++) {
    const rows: Pull["scopes"][string]["rows"] = [];
    for (let i = 0; i < 20; i++) {
      const id = `r${next() % 12}`;
      const rev = 1 + (next() % 100);
      const candidate = { ...row(id, rev), deleted: next() % 5 === 0 };
      if (candidate.deleted) candidate.data = null;
      rows.push(candidate);
      if (!expected.has(id) || expected.get(id)!.rev < rev)
        expected.set(id, candidate);
    }
    await f.engine.delta(response(rows, 100));
    const stored = await f.db.table<StoredRow>("rows").range();
    expect(stored).toHaveLength(expected.size);
    for (const held of stored)
      expect(held).toEqual({ ...expected.get(held.id), scope });
  }
});
it("newer pushed revision overtaking a buffered pull cannot be regressed by its late final page", async () => {
  const f = await fixture();
  const finalPage = deferred<unknown>();
  const reachedFinal = deferred<void>();
  let calls = 0;
  f.handle(async () => {
    if (++calls === 1) return response([row("one", 1)], 1, { more: true });
    reachedFinal.resolve();
    return finalPage.promise;
  });
  const pulling = f.engine.connect();
  await reachedFinal.promise;
  await f.engine.delta(response([row("one", 9, "pushed")], 9));
  finalPage.resolve(response([row("one", 2, "old-pull")], 2));
  await pulling;
  expect(f.engine.getSnapshot().rows[0]!.data).toBe("pushed");
  expect(await f.db.table<StoredScope, string>("scopes").get(scope)).toEqual({
    scope,
    cursor: 9,
  });
});
it("failed operation metadata persists across restart and can be discarded offline", async () => {
  const f = await fixture();
  f.handle(async (name) => {
    if (name === "sync.pull") return empty();
    throw new AppError("E_DENIED", "权限已变更");
  });
  await f.engine.enqueue(item("one"));
  await f.engine.connect();
  f.engine.close();
  const restored = f.make();
  await restored.hydrate();
  expect(restored.getSnapshot().outbox[0]).toMatchObject({
    op: "one",
    state: "failed",
    attempts: 1,
    error: { code: "E_DENIED", message: "权限已变更" },
  });
  expect(restored.getSnapshot().rows).toEqual([]);
  await restored.discard("one");
  expect(await f.db.table<OutboxItem[], string>("outbox").get("alice")).toEqual(
    [],
  );
});

describe("window page admission", () => {
  const windowModules = new ModuleRegistry([
    defineClientModule({
      id: "window",
      rowTypes: ["post"],
      reducers: {},
      repositories: {},
      windowed: { post: { seqOf: (row) => (row.data as { seq: number }).seq } },
    }),
  ]);
  const post = (seq: number, rev = seq) => ({
    id: String(seq),
    type: "post",
    rev,
    deleted: false,
    data: { seq },
  });
  it("persists disjoint pages, extends the newest window, and ignores uncached gap edits", async () => {
    const s = await fixture(windowModules);
    await s.engine.delta(response([], 1));
    await s.engine.loadRows(scope, [post(1), post(2), post(10)]);
    await s.engine.delta(
      response([post(3, 20), post(7, 21), post(11, 22)], 22),
    );
    expect(
      s.engine
        .getSnapshot()
        .rows.map((r) => r.id)
        .sort(),
    ).toEqual(["1", "10", "11", "2"]);
    expect(
      (await s.db.table<StoredScope, string>("scopes").get(scope))?.windows,
    ).toEqual({
      post: [
        [1, 2],
        [10, 11],
      ],
    });
    const restarted = s.make();
    await restarted.hydrate();
    expect(restarted.getSnapshot().rows).toHaveLength(4);
  });
  it("resets window intervals and prevents fetched pages from restoring revoked scopes", async () => {
    const s = await fixture(windowModules);
    await s.engine.delta(response([], 1));
    await s.engine.loadRows(scope, [post(1)]);
    await s.engine.delta(response([], 2, { reset: ["post"] }));
    expect(s.engine.getSnapshot().rows).toEqual([]);
    expect(
      (await s.db.table<StoredScope, string>("scopes").get(scope))?.windows,
    ).toEqual({ post: [] });
    await s.engine.delta({ scopes: {}, added: [], gone: [scope] });
    await expect(s.engine.loadRows(scope, [post(1)])).rejects.toMatchObject({
      code: "E_DENIED",
    });
    expect(s.engine.getSnapshot().rows).toEqual([]);
  });
  it("keeps redacted tombstone sequence slots across restart and never resurrects facts", async () => {
    const s = await fixture(windowModules);
    await s.engine.delta(response([], 1));
    await s.engine.loadRows(scope, [post(1)]);
    await s.engine.delta(response([{ ...post(1, 2), deleted: true }], 2));
    expect(s.engine.getSnapshot().rows[0]).toMatchObject({
      deleted: true,
      data: { seq: 1 },
      rev: 2,
    });
    await s.engine.loadRows(scope, [post(1, 3)]);
    await s.engine.delta(response([post(1, 4)], 4));
    expect(s.engine.getSnapshot().rows[0]).toMatchObject({
      deleted: true,
      data: { seq: 1 },
      rev: 2,
    });
    const restarted = s.make();
    await restarted.hydrate();
    expect(restarted.getSnapshot().rows[0]).toMatchObject({
      deleted: true,
      data: { seq: 1 },
    });
  });
  it("does not replace a newer delta with a stale page or advance its scope cursor", async () => {
    const s = await fixture(windowModules);
    await s.engine.delta(response([], 1));
    await s.engine.loadRows(scope, [post(1)]);
    await s.engine.delta(response([post(1, 9)], 9));
    await s.engine.loadRows(scope, [post(1, 2)]);
    expect(s.engine.getSnapshot().rows[0]?.rev).toBe(9);
    expect(
      (await s.db.table<StoredScope, string>("scopes").get(scope))?.cursor,
    ).toBe(9);
  });
});
