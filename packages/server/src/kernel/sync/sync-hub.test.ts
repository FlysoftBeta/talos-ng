import { describe, expect, it } from "vitest";
import type { Row } from "@talos/sync";
import { SyncHub } from "./sync-hub.ts";
import type { SyncResponse } from "./sync-hub.ts";

function fixture() {
  let revision = 1;
  let allowed = true;
  const rows: Row[] = [];
  const events: SyncResponse[] = [];
  const errors: unknown[] = [];
  const hub = new SyncHub({
    revision: () => revision,
    pageSize: 2,
    windowResetThreshold: 3,
    reportError: (e) => errors.push(e),
  });
  hub.registerProvider({
    match: (scope) => scope === "me:u",
    access: (user, scope) => allowed && user === "u" && scope === "me:u",
    list: () => ["me:u"],
    select: (_scope, cursor) => rows.filter((row) => row.rev > cursor),
  });
  for (const type of ["setting", "post"])
    hub.registerEntity(type, {
      windowed: type === "post",
      serialize: (row) => ({ ...row, data: row.deleted ? null : row.data }),
      read: (_scope, id) =>
        rows.find((row) => row.id === id && row.type === type),
    });
  return {
    hub,
    rows,
    events,
    errors,
    connection: {
      id: "c",
      emit: (_topic: string, data: unknown) =>
        events.push(data as SyncResponse),
    },
    rev: (value: number) => {
      revision = value;
    },
    access: (value: boolean) => {
      allowed = value;
    },
  };
}
function row(id: string, rev: number, type = "setting", deleted = false): Row {
  return { type, id, rev, deleted, data: { value: id } };
}

describe("SyncHub", () => {
  it("off-thread snapshots subscribe only when no commit raced them", async () => {
    const f = fixture();
    f.rows.push(row("a", 1));
    const deferred = () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      return { gate, release };
    };
    // A clean snapshot behaves exactly like a local pull.
    const clean = await f.hub.pullFrom(
      async (user, request) => f.hub.snapshot(user, request),
      "u",
      { cursors: {} },
      f.connection,
    );
    expect(clean).toEqual(f.hub.pull("u", { cursors: {} }));
    // A commit while the snapshot is in flight cannot reach the subscription
    // installed afterwards: the scope stays incomplete and a re-pull is asked.
    const raced = deferred();
    const pending = f.hub.pullFrom(
      async (user, request) => {
        const snapshot = f.hub.snapshot(user, request);
        await raced.gate;
        return snapshot;
      },
      "u",
      { cursors: { "me:u": 1 } },
      f.connection,
    );
    f.rows.push(row("b", 2));
    f.rev(2);
    f.hub.committed({
      rev: 2,
      changes: [{ scope: "me:u", type: "setting", id: "b" }],
    });
    raced.release();
    const dirty = await pending;
    expect(dirty.repull).toBe(true);
    expect(dirty.scopes["me:u"]).toEqual({ rows: [], cursor: 1, more: true });
    f.events.length = 0;
    f.hub.committed({
      rev: 2,
      changes: [{ scope: "me:u", type: "setting", id: "b" }],
    });
    expect(f.events).toEqual([]);
    // The retry is computed locally, so it cannot race again.
    const retry = await f.hub.pullFrom(
      () => Promise.reject(new Error("must not be called")),
      "u",
      { cursors: { "me:u": 1 } },
      f.connection,
    );
    expect(retry.scopes["me:u"]).toEqual({
      rows: [row("b", 2)],
      cursor: 2,
      more: false,
    });
    f.hub.committed({
      rev: 2,
      changes: [{ scope: "me:u", type: "setting", id: "b" }],
    });
    expect(f.events).toHaveLength(1);
    // A disconnect during the snapshot never installs a subscription.
    const closing = deferred();
    const abandoned = f.hub.pullFrom(
      async (user, request) => {
        await closing.gate;
        return f.hub.snapshot(user, request);
      },
      "u",
      { cursors: {} },
      { id: "gone", emit: () => f.events.push({} as SyncResponse) },
    );
    f.hub.unsubscribe("gone");
    closing.release();
    await expect(abandoned).rejects.toMatchObject({ code: "E_CONFLICT" });
    f.events.length = 0;
    f.hub.committed({
      rev: 2,
      changes: [{ scope: "me:u", type: "setting", id: "b" }],
    });
    expect(f.events).toHaveLength(1);
  });
  it("revoked access during an off-thread snapshot drops the scope", async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pending = f.hub.pullFrom(
      async (user, request) => {
        const snapshot = f.hub.snapshot(user, request);
        await gate;
        return snapshot;
      },
      "u",
      { cursors: { "me:u": 0 } },
      f.connection,
    );
    f.access(false);
    f.hub.refreshAccess();
    release();
    expect(await pending).toEqual({
      scopes: {},
      gone: ["me:u"],
      added: [],
      repull: true,
    });
  });
  it("skips access re-evaluation for access-neutral change sets", () => {
    const f = fixture();
    const neutral = new SyncHub({ revision: () => 1 });
    let lists = 0;
    neutral.registerProvider({
      match: (scope) => scope === "me:u",
      access: () => true,
      list: () => {
        lists++;
        return ["me:u"];
      },
      select: () => [],
    });
    neutral.registerEntity("setting", {
      accessNeutral: true,
      serialize: (r) => r,
      read: () => row("a", 1),
    });
    neutral.registerEntity("profile", {
      serialize: (r) => r,
      read: () => row("p", 1, "profile"),
    });
    neutral.pull("u", { cursors: {} }, f.connection);
    lists = 0;
    neutral.committed({
      rev: 1,
      changes: [{ scope: "me:u", type: "setting", id: "a" }],
    });
    expect(lists).toBe(0);
    expect(f.events.pop()?.scopes["me:u"]?.rows).toEqual([row("a", 1)]);
    neutral.committed({
      rev: 1,
      changes: [{ scope: "me:u", type: "profile", id: "p" }],
    });
    neutral.committed({ rev: 1, changes: [] });
    expect(lists).toBe(2);
  });
  it("lists added and gone scopes without exposing another user", () => {
    const f = fixture();
    expect(f.hub.pull("u", { cursors: { forbidden: 0 } })).toEqual({
      added: ["me:u"],
      gone: ["forbidden"],
      scopes: { "me:u": { rows: [], cursor: 1, more: false } },
    });
    expect(f.hub.pull("other", { cursors: { "me:u": 0 } })).toEqual({
      added: [],
      gone: ["me:u"],
      scopes: {},
    });
  });
  it("paginates without splitting a revision group and subscribes after the last page", () => {
    const f = fixture();
    f.rev(3);
    f.rows.push(row("a", 1), row("b", 1), row("c", 1), row("d", 3));
    const first = f.hub.pull("u", { cursors: {} }, f.connection).scopes[
      "me:u"
    ]!;
    expect(first).toMatchObject({
      rows: [row("a", 1), row("b", 1), row("c", 1)],
      cursor: 1,
      more: true,
    });
    f.hub.committed({
      rev: 3,
      changes: [{ scope: "me:u", type: "setting", id: "d" }],
    });
    expect(f.events).toHaveLength(0);
    const last = f.hub.pull(
      "u",
      { cursors: { "me:u": first.cursor } },
      f.connection,
    ).scopes["me:u"]!;
    expect(last).toEqual({ rows: [row("d", 3)], cursor: 3, more: false });
    f.hub.committed({
      rev: 3,
      changes: [{ scope: "me:u", type: "setting", id: "d" }],
    });
    expect(f.events[0]?.scopes["me:u"]).toEqual(last);
  });
  it("re-reads and serializes changed rows once identically to pulls, including tombstones", () => {
    const f = fixture();
    f.rows.push(row("a", 1, "setting", true));
    const pull = f.hub.pull("u", { cursors: {} }, f.connection);
    const change = { scope: "me:u", type: "setting", id: "a" };
    f.hub.committed({ rev: 1, changes: [change, change] });
    expect(f.events[0]?.scopes).toEqual(pull.scopes);
    expect(f.events[0]?.scopes["me:u"]?.rows[0]?.data).toBeNull();
  });
  it("revocation emits gone immediately and a regained scope requires a fresh pull", () => {
    const f = fixture();
    f.hub.pull("u", { cursors: {} }, f.connection);
    f.access(false);
    f.hub.refreshAccess();
    expect(f.events.pop()).toEqual({ scopes: {}, gone: ["me:u"], added: [] });
    f.rows.push(row("a", 1));
    f.hub.committed({
      rev: 1,
      changes: [{ scope: "me:u", type: "setting", id: "a" }],
    });
    expect(f.events).toHaveLength(0);
    f.access(true);
    f.hub.refreshAccess();
    expect(f.events.pop()).toEqual({ scopes: {}, gone: [], added: ["me:u"] });
    f.hub.committed({
      rev: 1,
      changes: [{ scope: "me:u", type: "setting", id: "a" }],
    });
    expect(f.events).toHaveLength(0);
  });
  it("resets only overloaded window types and preserves ordinary rows", () => {
    const f = fixture();
    f.rev(9);
    f.rows.push(
      row("a", 1),
      ...[2, 3, 4, 5].map((n) => row(String(n), n, "post")),
      row("b", 6),
      row("c", 7),
    );
    const first = f.hub.pull("u", { cursors: {}, windowed: ["me:u"] }).scopes[
      "me:u"
    ]!;
    expect(first).toEqual({
      rows: [row("a", 1), row("b", 6)],
      cursor: 6,
      more: true,
      reset: ["post"],
    });
    const second = f.hub.pull("u", { cursors: { "me:u": 6 } }).scopes["me:u"]!;
    expect(second).toEqual({ rows: [row("c", 7)], cursor: 9, more: false });
  });
  it("omits windowed rows of scopes the client holds no window in", () => {
    const f = fixture();
    f.rev(4);
    f.rows.push(row("p1", 1, "post"), row("p2", 2, "post"), row("s", 3));
    f.rows.push(row("p3", 4, "post"));
    // Without a declared window the client would discard every post: they are
    // skipped without a reset and without holding the cursor below them.
    expect(
      f.hub.pull("u", { cursors: {}, windowed: [] }).scopes["me:u"],
    ).toEqual({ rows: [row("s", 3)], cursor: 4, more: false });
    expect(
      f.hub
        .pull("u", { cursors: { "me:u": 1 }, windowed: ["me:u"] })
        .scopes["me:u"]!.rows.map((item) => item.id),
    ).toEqual(["p2", "s"]);
  });
  it("combines module providers sharing a scope before revision paging", () => {
    const f = fixture();
    f.rev(3);
    f.rows.push(row("a", 1), row("c", 3));
    f.hub.registerProvider({
      match: () => true,
      access: () => true,
      list: () => ["me:u"],
      select: () => [row("b", 1)],
    });
    expect(f.hub.pull("u", { cursors: {} }).scopes["me:u"]?.rows).toEqual([
      row("a", 1),
      row("b", 1),
    ]);
  });
  it("isolates failed connections and unregisters disconnected subscribers", () => {
    const f = fixture();
    f.rows.push(row("a", 1));
    f.hub.pull(
      "u",
      { cursors: {} },
      {
        id: "broken",
        emit: () => {
          throw new Error("offline");
        },
      },
    );
    f.hub.pull("u", { cursors: {} }, f.connection);
    f.hub.committed({
      rev: 1,
      changes: [{ scope: "me:u", type: "setting", id: "a" }],
    });
    expect(f.events).toHaveLength(1);
    expect(f.errors).toHaveLength(2);
    f.hub.unsubscribe("c");
    f.hub.clear();
    f.hub.committed({ rev: 1, changes: [] });
    expect(f.events).toHaveLength(1);
  });
  it("rejects invalid cursors, duplicate entities and inconsistent serializers", () => {
    const f = fixture();
    for (const cursor of [-1, 2, NaN, 0.5])
      expect(() => f.hub.pull("u", { cursors: { "me:u": cursor } })).toThrow();
    expect(() => f.hub.pull("u", { cursors: {}, limit: 0 })).toThrow();
    expect(() =>
      f.hub.registerEntity("setting", {
        read: () => undefined,
        serialize: (r) => r,
      }),
    ).toThrow();
    f.hub.registerEntity("broken", {
      read: () => undefined,
      serialize: (r) => ({ ...r, id: "changed" }),
    });
    f.rows.push(row("x", 1, "broken"));
    expect(() => f.hub.pull("u", { cursors: {} })).toThrow("标识");
  });
  it("denies a shared scope when any matching provider revokes access", () => {
    const f = fixture();
    f.hub.registerProvider({
      match: (scope) => scope === "me:u",
      access: () => true,
      list: () => ["me:u"],
      select: () => [],
    });
    f.hub.pull("u", { cursors: {} }, f.connection);
    f.access(false);
    f.hub.refreshAccess();
    expect(f.events[0]?.gone).toEqual(["me:u"]);
    expect(f.hub.pull("u", { cursors: { "me:u": 0 } }).scopes).toEqual({});
  });
  it("scans bounded provider batches, keeps whole large revisions, and resets accumulated windows", () => {
    const rows: Row[] = [];
    for (let n = 0; n < 700; n++) rows.push(row(`group-${n}`, 1));
    for (let n = 0; n < 4000; n++) rows.push(row(`post-${n}`, n + 2, "post"));
    rows.push(row("tail", 4002));
    const requested: number[] = [];
    const hub = new SyncHub({
      revision: () => 4002,
      pageSize: 2,
      windowResetThreshold: 100,
    });
    hub.registerProvider({
      match: () => true,
      access: () => true,
      list: () => ["scope"],
      select: (_scope, since, limit) => {
        requested.push(limit);
        return rows.filter((r) => r.rev > since).slice(0, limit);
      },
    });
    for (const type of ["setting", "post"])
      hub.registerEntity(type, {
        windowed: type === "post",
        serialize: (r) => r,
        read: () => undefined,
      });
    const first = hub.pull("u", { cursors: {}, windowed: ["scope"] }).scopes
      .scope!;
    expect(first.rows).toHaveLength(700);
    expect(first.more).toBe(true);
    expect(first.cursor).toBe(1);
    expect(first.reset).toEqual(["post"]);
    expect(Math.max(...requested)).toBe(1024);
    const final = hub.pull("u", {
      cursors: { scope: first.cursor },
      windowed: ["scope"],
    }).scopes.scope!;
    expect(final.rows).toEqual([row("tail", 4002)]);
    expect(final.more).toBe(false);
    expect(final.cursor).toBe(4002);
  });
  it.each([
    ["unregistered types", { ...row("a", 1), type: "unknown" }],
    ["future revisions", row("a", 2)],
    ["invalid row identifiers", { ...row("a", 1), id: "" }],
    ["invalid revision values", { ...row("a", 1), rev: NaN }],
  ])("rejects %s before returning a pull", (_name, invalid) => {
    const f = fixture();
    f.hub.registerProvider({
      match: (scope) => scope === "me:u",
      access: () => true,
      list: () => [],
      select: () => [invalid as Row],
    });
    expect(() => f.hub.pull("u", { cursors: {} })).toThrowError(
      expect.objectContaining({ code: "E_INTERNAL" }),
    );
  });
  it("detects unregistered rows beyond the retained first-page candidates", () => {
    const f = fixture();
    f.rev(600);
    for (let n = 1; n <= 500; n++) f.rows.push(row(String(n), n));
    f.rows.push(row("unknown", 501, "unknown"));
    expect(() => f.hub.pull("u", { cursors: {}, limit: 1 })).toThrow("未注册");
  });
  it("rejects a provider that fails to advance instead of looping", () => {
    const f = fixture();
    f.rev(300);
    for (let n = 1; n <= 300; n++) f.rows.push(row(String(n), n));
    let calls = 0;
    const hub = new SyncHub({ revision: () => 300 });
    hub.registerEntity("setting", {
      read: () => undefined,
      serialize: (value) => value,
    });
    hub.registerProvider({
      match: () => true,
      access: () => true,
      list: () => ["scope"],
      select: (_scope, _cursor, limit) => {
        calls++;
        return f.rows.slice(0, limit);
      },
    });
    expect(() => hub.pull("u", { cursors: {} })).toThrow("顺序异常");
    expect(calls).toBe(2);
  });
  it("rejects descending and duplicate rows, including oversized repeated revision groups", () => {
    const f = fixture();
    f.rev(3);
    f.rows.push(row("a", 3), row("b", 2));
    expect(() => f.hub.pull("u", { cursors: {} })).toThrow("顺序异常");
    f.rows.splice(
      0,
      f.rows.length,
      ...Array.from({ length: 300 }, () => row("same", 1)),
    );
    expect(() => f.hub.pull("u", { cursors: {} })).toThrow("重复");
  });
  it("publishes no partial subscription when a later scope fails validation", () => {
    const events: unknown[] = [];
    const hub = new SyncHub({ revision: () => 1 });
    hub.registerEntity("setting", {
      serialize: (value) => value,
      read: () => row("a", 1),
    });
    hub.registerProvider({
      match: () => true,
      access: () => true,
      list: () => ["first", "second"],
      select: (scope) =>
        scope === "first" ? [row("a", 1)] : [row("b", 1, "unknown")],
    });
    expect(() =>
      hub.pull(
        "u",
        { cursors: {} },
        { id: "connection", emit: (_topic, data) => events.push(data) },
      ),
    ).toThrow("未注册");
    hub.committed({
      rev: 1,
      changes: [{ scope: "first", type: "setting", id: "a" }],
    });
    expect(events).toHaveLength(0);
  });
  it("reports invalid point reads without emitting a cursor beyond the changed row", () => {
    const f = fixture();
    f.hub.pull("u", { cursors: {} }, f.connection);
    f.rows.push(row("a", 2));
    f.hub.committed({
      rev: 1,
      changes: [{ scope: "me:u", type: "setting", id: "a" }],
    });
    expect(f.events).toEqual([
      { scopes: {}, gone: [], added: [], repull: true },
    ]);
    expect(f.errors).toEqual([expect.objectContaining({ code: "E_INTERNAL" })]);
    f.hub.committed({
      rev: 2,
      changes: [{ scope: "me:u", type: "setting", id: "a" }],
    });
    expect(f.events).toHaveLength(1);
    expect(f.errors).toHaveLength(2);
  });
  it("changing the bound user never retains the old subscription", () => {
    const f = fixture();
    f.hub.pull("u", { cursors: {} }, f.connection);
    f.hub.pull("other", { cursors: {} }, f.connection);
    f.rows.push(row("a", 1));
    f.hub.committed({
      rev: 1,
      changes: [{ scope: "me:u", type: "setting", id: "a" }],
    });
    expect(f.events).toHaveLength(0);
  });
  it("paged pulls converge across deterministic histories", () => {
    for (let limit = 1; limit <= 9; limit++) {
      const f = fixture();
      f.rev(30);
      for (let n = 1; n <= 100; n++)
        f.rows.push(
          row(String(n), 1 + Math.floor(n / 5), "setting", n % 7 === 0),
        );
      let cursor = 0;
      const received: Row[] = [];
      for (;;) {
        const page = f.hub.pull("u", { cursors: { "me:u": cursor }, limit })
          .scopes["me:u"]!;
        received.push(...page.rows);
        cursor = page.cursor;
        if (!page.more) break;
      }
      expect(received).toHaveLength(100);
      expect(new Set(received.map((r) => r.id)).size).toBe(100);
      expect(cursor).toBe(30);
    }
  });
});

it("bounds sync wire bytes across scopes without splitting revisions or losing rows", () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({
    ...row(String(i), i + 1),
    data: "汉".repeat(14000),
  }));
  const hub = new SyncHub({ revision: () => 8, pageSize: 100 });
  hub.registerEntity("setting", {
    serialize: (r) => r,
    read: (_scope, id) => rows.find((r) => r.id === id),
  });
  hub.registerProvider({
    match: () => true,
    access: () => true,
    list: () => ["a", "b"],
    select: (_scope, since) => rows.filter((r) => r.rev > since),
  });
  const cursors: Record<string, number> = {};
  const seen: Record<string, string[]> = { a: [], b: [] };
  for (let i = 0; i < 10; i++) {
    const result = hub.pull("u", { cursors });
    expect(
      new TextEncoder().encode(JSON.stringify(result)).length,
    ).toBeLessThan(256 * 1024);
    for (const [scope, page] of Object.entries(result.scopes)) {
      cursors[scope] = page.cursor;
      seen[scope]!.push(...page.rows.map((r) => r.id));
    }
    if (Object.values(result.scopes).every((page) => !page.more)) break;
  }
  expect(seen.a).toEqual(rows.map((r) => r.id));
  expect(seen.b).toEqual(rows.map((r) => r.id));
  expect(cursors).toEqual({ a: 8, b: 8 });
});

it("fragments escaped Unicode rows and catches commits during transfer before subscribing", () => {
  const f = fixture();
  const large = { ...row("large", 1), data: '😀汉"\\\n'.repeat(60000) };
  f.rows.push(large);
  let result = f.hub.pull("u", { cursors: {} }, f.connection);
  expect(result.transfer).toBeDefined();
  const chunks: string[] = [];
  f.rev(2);
  f.rows.push(row("during", 2));
  f.hub.committed({
    rev: 2,
    changes: [{ scope: "me:u", type: "setting", id: "during" }],
  });
  expect(f.events).toHaveLength(0);
  for (;;) {
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
      160 * 1024,
    );
    chunks.push(result.transfer!.chunk);
    if (!result.transfer!.more) break;
    result = f.hub.pull(
      "u",
      { cursors: {}, continuation: result.transfer!.token },
      f.connection,
    );
  }
  expect(result.repull).toBe(true);
  const assembled = JSON.parse(chunks.join("")) as SyncResponse;
  expect(assembled.scopes["me:u"]).toEqual({
    rows: [large],
    cursor: 1,
    more: false,
  });
  const tail = f.hub.pull("u", { cursors: { "me:u": 1 } }, f.connection);
  expect(tail.scopes["me:u"]).toEqual({
    rows: [row("during", 2)],
    cursor: 2,
    more: false,
  });
  f.hub.committed({
    rev: 2,
    changes: [{ scope: "me:u", type: "setting", id: "during" }],
  });
  expect(f.events).toEqual([tail]);
});

it("binds continuation to the user and connection and invalidates replay, revocation and disconnect", () => {
  const f = fixture();
  f.rows.push({ ...row("large", 1), data: "x".repeat(600000) });
  const start = () =>
    f.hub.pull("u", { cursors: {} }, f.connection).transfer!.token;
  let token = start();
  const resume = (continuation: string) =>
    f.hub.pull("u", { cursors: {}, continuation }, f.connection);
  expect(() =>
    f.hub.pull("other", { cursors: {}, continuation: token }, f.connection),
  ).toThrow();
  expect(() =>
    f.hub.pull(
      "u",
      { cursors: {}, continuation: token },
      { ...f.connection, id: "other" },
    ),
  ).toThrow();
  token = start();
  resume(token);
  expect(() => resume(token)).toThrow(
    expect.objectContaining({ code: "E_CONFLICT" }),
  );
  token = start();
  f.access(false);
  expect(() => resume(token)).toThrow(
    expect.objectContaining({ code: "E_CONFLICT" }),
  );
  f.access(true);
  token = start();
  f.hub.unsubscribe(f.connection.id);
  expect(() => resume(token)).toThrow(
    expect.objectContaining({ code: "E_CONFLICT" }),
  );
});

it("expires abandoned transfers and a new pull restarts from its requested cursor", () => {
  let now = 0;
  const hub = new SyncHub({ revision: () => 1, now: () => now });
  const large = { ...row("large", 1), data: "x".repeat(300000) };
  hub.registerEntity("setting", { serialize: (r) => r, read: () => large });
  hub.registerProvider({
    match: () => true,
    access: () => true,
    list: () => ["scope"],
    select: () => [large],
  });
  const token = hub.pull("u", { cursors: {} }).transfer!.token;
  now = 60000;
  expect(() => hub.pull("u", { cursors: {}, continuation: token })).toThrow(
    expect.objectContaining({ code: "E_CONFLICT" }),
  );
  expect(hub.pull("u", { cursors: {} }).transfer?.token).not.toBe(token);
});

it("oversized pushes request a pull and suppress later cursor advances until catch-up", () => {
  const f = fixture();
  f.hub.pull("u", { cursors: {} }, f.connection);
  f.rev(2);
  f.rows.push({ ...row("large", 2), data: "x".repeat(300000) });
  f.hub.committed({
    rev: 2,
    changes: [{ scope: "me:u", type: "setting", id: "large" }],
  });
  expect(f.events).toEqual([{ scopes: {}, gone: [], added: [], repull: true }]);
  f.rev(3);
  f.rows.push(row("small", 3));
  f.hub.committed({
    rev: 3,
    changes: [{ scope: "me:u", type: "setting", id: "small" }],
  });
  expect(f.events).toHaveLength(1);
  expect(f.errors).toEqual([]);
  expect(
    f.hub.pull("u", { cursors: { "me:u": 1 } }, f.connection).transfer,
  ).toBeDefined();
});

it("finishes metadata-only transfers with thousands of scopes and subscribes after the last fragment", () => {
  const scopes = Array.from(
    { length: 4000 },
    (_, i) => `coll:${String(i).padStart(26, "0")}`,
  );
  const events: SyncResponse[] = [];
  let revision = 1;
  const hub = new SyncHub({ revision: () => revision });
  hub.registerProvider({
    match: () => true,
    access: () => true,
    list: () => scopes,
    select: () => [],
  });
  hub.registerEntity("setting", {
    serialize: (r) => r,
    read: () => row("later", revision),
  });
  const connection = {
    id: "many",
    emit: (_topic: string, data: unknown) => events.push(data as SyncResponse),
  };
  let page = hub.pull("u", { cursors: {} }, connection);
  const chunks: string[] = [];
  let count = 0;
  for (;;) {
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(
      160 * 1024,
    );
    chunks.push(page.transfer!.chunk);
    if (!page.transfer!.more) break;
    expect(++count).toBeLessThan(20);
    // Pull preparation may bump the global revision without changing rows.
    hub.committed({ rev: ++revision, changes: [] });
    page = hub.pull(
      "u",
      { cursors: {}, continuation: page.transfer!.token },
      connection,
    );
  }
  expect(page.repull).toBeUndefined();
  const assembled = JSON.parse(chunks.join("")) as SyncResponse;
  expect(Object.keys(assembled.scopes)).toHaveLength(4000);
  expect(Object.values(assembled.scopes).every((scope) => !scope.more)).toBe(
    true,
  );
  hub.committed({
    rev: revision,
    changes: [{ scope: scopes[0]!, type: "setting", id: "later" }],
  });
  expect(events[0]?.scopes[scopes[0]!]!.rows).toEqual([row("later", revision)]);
});

it("repairs a transient push failure before allowing a later small delta to advance", () => {
  const f = fixture();
  let fail = true;
  const connection = {
    id: "transient",
    emit: (_topic: string, data: unknown) => {
      if (fail) {
        fail = false;
        throw new Error("carrier rejected event");
      }
      f.events.push(data as SyncResponse);
    },
  };
  f.hub.pull("u", { cursors: {} }, connection);
  f.rev(2);
  f.rows.push(row("missed", 2));
  f.hub.committed({
    rev: 2,
    changes: [{ scope: "me:u", type: "setting", id: "missed" }],
  });
  expect(f.events).toEqual([{ scopes: {}, gone: [], added: [], repull: true }]);
  f.rev(3);
  f.rows.push(row("later", 3));
  f.hub.committed({
    rev: 3,
    changes: [{ scope: "me:u", type: "setting", id: "later" }],
  });
  expect(f.events).toHaveLength(1);
  const pulled = f.hub.pull("u", { cursors: { "me:u": 1 } }, connection);
  expect(pulled.scopes["me:u"]!.rows).toEqual([
    row("missed", 2),
    row("later", 3),
  ]);
  f.hub.committed({
    rev: 3,
    changes: [{ scope: "me:u", type: "setting", id: "later" }],
  });
  expect(f.events[1]?.scopes["me:u"]?.rows).toEqual([row("later", 3)]);
});
