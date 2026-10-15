import { describe, expect, it, vi } from "vitest";
import { AppError } from "@talos/base";
import { MAX_FUTURE_SKEW_MS } from "@talos/contract";
import { Db } from "../../kernel/persistence/db.ts";
import { Uow } from "../../kernel/persistence/uow.ts";
import { SyncHub } from "../../kernel/sync/sync-hub.ts";
import { IdentityService } from "../identity/index.ts";
import { MeService } from "./index.ts";
const opA = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const opB = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
function setup(pageSize = 500) {
  const db = new Db();
  const hub = new SyncHub({ revision: () => uow.revision, pageSize });
  const uow = new Uow(db, hub);
  const identity = new IdentityService({ db, uow, now: () => 1000 });
  const me = new MeService({
    db,
    uow,
    identity: identity.repo,
    now: () => 1000,
  });
  me.registerSync(hub);
  const user = identity.createUser({ pin: "123456", name: "test" });
  return { db, hub, uow, me, user };
}
describe("me", () => {
  it("bounds repository selections and rejects unbounded or invalid limits", () => {
    const s = setup();
    try {
      s.uow.write((ctx) => {
        for (let i = 0; i < 10; i++)
          s.me.repo.put(
            s.user.id,
            `key${i}`,
            { v: i, t: { ms: 1000, counter: 0 }, op: opA },
            ctx.rev,
          );
      });
      expect(s.me.repo.select(s.user.id, 0, 3).map((row) => row.id)).toEqual([
        "key0",
        "key1",
        "key2",
      ]);
      expect(s.me.repo.select(s.user.id, s.uow.revision, 3)).toEqual([]);
      for (const limit of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
        expect(() => s.me.repo.select(s.user.id, 0, limit)).toThrow(
          expect.objectContaining({ code: "E_INVALID" }),
        );
    } finally {
      s.db.close();
    }
  });
  it("pages a profile and bounded settings without cutting a large revision group", () => {
    const s = setup(1);
    try {
      const scope = `me:${s.user.id}`;
      s.uow.write((ctx) => {
        for (let i = 0; i < 300; i++)
          s.me.repo.put(
            s.user.id,
            `key${String(i).padStart(3, "0")}`,
            { v: i, t: { ms: 1000, counter: 0 }, op: opA },
            ctx.rev,
          );
      });
      s.me.set(s.user.id, {
        key: "tail",
        value: { v: true, t: { ms: 1000, counter: 0 }, op: opB },
      });
      const select = vi.spyOn(s.me.repo, "select");
      const first = s.hub.pull(s.user.id, { cursors: {}, limit: 1 }).scopes[
        scope
      ]!;
      expect(first.rows.map((row) => row.type)).toEqual(["profile"]);
      expect(first.more).toBe(true);
      const middle = s.hub.pull(s.user.id, {
        cursors: { [scope]: first.cursor },
        limit: 1,
      }).scopes[scope]!;
      expect(middle.rows).toHaveLength(300);
      expect(new Set(middle.rows.map((row) => row.rev)).size).toBe(1);
      expect(middle.more).toBe(true);
      const final = s.hub.pull(s.user.id, {
        cursors: { [scope]: middle.cursor },
        limit: 1,
      }).scopes[scope]!;
      expect(final.rows.map((row) => row.id)).toEqual(["tail"]);
      expect(final.more).toBe(false);
      expect(final.cursor).toBe(s.uow.revision);
      expect(select.mock.calls.some((call) => call[2] === 256)).toBe(true);
      expect(select.mock.calls.some((call) => call[2] === 512)).toBe(true);
      for (const [index, result] of select.mock.results.entries())
        if (result.type === "return")
          expect(result.value.length).toBeLessThanOrEqual(
            select.mock.calls[index]![2],
          );
    } finally {
      s.db.close();
    }
  });
  it("merges writes by timestamp and operation id and clamps future stamps", () => {
    const s = setup();
    try {
      s.me.set(s.user.id, {
        key: "theme",
        value: { v: "light", t: { ms: 1000, counter: 0 }, op: opA },
      });
      s.me.set(s.user.id, {
        key: "theme",
        value: { v: "dark", t: { ms: 1000, counter: 0 }, op: opB },
      });
      const old = s.me.set(s.user.id, {
        key: "theme",
        value: { v: "old", t: { ms: 1000, counter: 0 }, op: opA },
      });
      expect(old.setting.value.v).toBe("dark");
      const future = s.me.set(s.user.id, {
        key: "theme",
        value: {
          v: "future",
          t: { ms: Number.MAX_SAFE_INTEGER, counter: 4 },
          op: opA,
        },
      });
      expect(future.setting.value.t).toEqual({
        ms: 1000 + MAX_FUTURE_SKEW_MS,
        counter: 0,
      });
    } finally {
      s.db.close();
    }
  });
  it("converges for deterministic permutations and duplicate writes", () => {
    const s = setup();
    try {
      let seed = 12345;
      const random = (): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed;
      };
      for (let trial = 0; trial < 20; trial++) {
        const values = Array.from({ length: 12 }, (_, i) => ({
          v: i,
          t: { ms: 900 + i, counter: 0 },
          op: opA,
        }));
        for (let i = values.length - 1; i > 0; i--) {
          const j = random() % (i + 1);
          [values[i], values[j]] = [values[j]!, values[i]!];
        }
        for (const value of values.concat(values))
          s.me.set(s.user.id, { key: `trial${trial}`, value });
        expect(s.me.repo.get(s.user.id, `trial${trial}`)?.value.v).toBe(11);
      }
    } finally {
      s.db.close();
    }
  });
  it("publishes identical authoritative row shapes in pull and delta", () => {
    const s = setup();
    try {
      const events: unknown[] = [];
      const scope = `me:${s.user.id}`;
      s.hub.pull(
        s.user.id,
        { cursors: {} },
        { id: "c", emit: (_topic, data) => events.push(data) },
      );
      s.me.set(s.user.id, {
        key: "theme",
        value: { v: "dark", t: { ms: 1000, counter: 0 }, op: opA },
      });
      const pull = s.hub.pull(s.user.id, { cursors: { [scope]: 1 } });
      expect(events[0]).toEqual({ ...pull, added: [] });
      expect(pull.scopes[scope]?.rows[0]?.data).toEqual(
        s.me.repo.get(s.user.id, "theme"),
      );
    } finally {
      s.db.close();
    }
  });
  it("returns gone on revocation and never exposes another user's scope", () => {
    const s = setup();
    try {
      const scope = `me:${s.user.id}`;
      const events: unknown[] = [];
      s.hub.pull(
        s.user.id,
        { cursors: {} },
        { id: "c", emit: (_topic, data) => events.push(data) },
      );
      expect(s.hub.pull("unknown", { cursors: { [scope]: 0 } }).gone).toEqual([
        scope,
      ]);
      s.db.run("UPDATE users SET banned=1 WHERE id=?", s.user.id);
      s.hub.refreshAccess();
      expect(events[0]).toEqual({ scopes: {}, gone: [scope], added: [] });
    } finally {
      s.db.close();
    }
  });
  it("rolls settings and notifications back with the outer unit of work", () => {
    const s = setup();
    try {
      const events: unknown[] = [];
      s.hub.pull(
        s.user.id,
        { cursors: {} },
        { id: "c", emit: (_topic, data) => events.push(data) },
      );
      expect(() =>
        s.uow.write(() => {
          s.me.set(s.user.id, {
            key: "theme",
            value: { v: "dark", t: { ms: 1000, counter: 0 }, op: opA },
          });
          throw new AppError("E_CANCELLED", "abort");
        }),
      ).toThrow("abort");
      expect(s.me.repo.get(s.user.id, "theme")).toBeUndefined();
      expect(events).toEqual([]);
    } finally {
      s.db.close();
    }
  });
});
