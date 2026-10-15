import { AppError } from "@talos/base";
import { describe, expect, it } from "vitest";
import { random } from "../test/random.ts";
import { IntervalSet } from "./intervals.ts";
import type { IntervalSetJSON } from "./intervals.ts";
import { mergePage, planApply, selectDelta } from "./delta.ts";
import type { ApplyOperation, Row, ScopePull, ScopeState } from "./delta.ts";

const row = (id: number, rev = id, type = "post", deleted = false): Row => ({
  type,
  id: String(id),
  rev,
  deleted,
  data: { seq: id, value: rev },
});
const seqOf = (item: Row): number => (item.data as { seq: number }).seq;
const options = { windowed: { post: { seqOf } } };
const state: ScopeState = {
  cursor: 0,
  windows: {
    post: [
      [1, 3],
      [8, 10],
    ],
  },
};
const pull = (rows: readonly Row[], cursor = 100): ScopePull => ({
  rows,
  cursor,
  more: false,
});
const key = (r: Pick<Row, "type" | "id">): string =>
  JSON.stringify([r.type, r.id]);

class Executor {
  cursor = 0;
  windows: Record<string, IntervalSetJSON> = {};
  rows = new Map<string, Row>();
  get state(): ScopeState {
    return { cursor: this.cursor, windows: this.windows };
  }
  apply(ops: readonly ApplyOperation[]): void {
    for (const op of ops) {
      switch (op.kind) {
        case "dropType":
          for (const [id, held] of this.rows)
            if (held.type === op.type) this.rows.delete(id);
          break;
        case "setCursor":
          this.cursor = op.cursor;
          break;
        case "setWindow":
          this.windows = { ...this.windows, [op.type]: op.intervals };
          break;
        case "put":
          if ((this.rows.get(key(op.row))?.rev ?? -1) < op.row.rev)
            this.rows.set(key(op.row), op.row);
          break;
        case "delete":
          if ((this.rows.get(key(op))?.rev ?? -1) < op.rev)
            this.rows.set(key(op), {
              type: op.type,
              id: op.id,
              rev: op.rev,
              deleted: true,
              data: null,
            });
          break;
      }
    }
  }
}

describe("scope delta planner", () => {
  it("emits conditional writes and retains deletion revisions against stale replay", () => {
    const db = new Executor();
    db.apply(
      planApply(
        db.state,
        pull([
          row(1, 5, "setting"),
          row(1, 4, "setting"),
          row(1, 6, "setting", true),
        ]),
        options,
      ),
    );
    expect(db.rows.get(key(row(1, 0, "setting")))?.deleted).toBe(true);
    db.apply(
      mergePage(db.state, "setting", [row(1, 5, "setting")], {
        lo: 1,
        hi: 1,
        complete: true,
      }),
    );
    expect(db.rows.get(key(row(1, 0, "setting")))?.rev).toBe(6);
    expect(db.cursor).toBe(100);
  });

  it("applies held windows and contiguous head extensions but ignores gaps and older extensions", () => {
    const ops = planApply(
      state,
      pull([
        row(12),
        row(4),
        row(0),
        row(2),
        row(20),
        row(11),
        row(9, 21, "post", true),
      ]),
      options,
    );
    expect(
      ops.filter((op) => op.kind === "put").map((op) => op.row.id),
    ).toEqual(["2", "11", "12"]);
    expect(ops).toContainEqual({
      kind: "delete",
      type: "post",
      id: "9",
      rev: 21,
      ifNewer: true,
    });
    expect(ops).toContainEqual({
      kind: "setWindow",
      type: "post",
      intervals: [
        [1, 3],
        [8, 12],
      ],
    });
    expect(state.windows.post).toEqual([
      [1, 3],
      [8, 10],
    ]);
  });

  it("does not invent a first window from deltas", () => {
    const ops = planApply(
      { cursor: 0, windows: {} },
      pull([row(1), row(2)]),
      options,
    );
    expect(ops.filter((op) => op.kind === "put")).toEqual([]);
    expect(ops).toContainEqual({
      kind: "setWindow",
      type: "post",
      intervals: [],
    });
  });

  it("buffers all pages, and extends the head despite reversed sequence arrival", () => {
    const first: ScopePull = { rows: [row(12, 1)], cursor: 1, more: true };
    const final: ScopePull = { rows: [row(11, 2)], cursor: 2, more: false };
    expect(planApply(state, first, options)).toEqual([]);
    expect(planApply(state, [first], options)).toEqual([]);
    const ops = planApply(state, [first, final], options);
    expect(ops.filter((op) => op.kind === "put")).toHaveLength(2);
    expect(ops[ops.length - 1]).toEqual({ kind: "setCursor", cursor: 2 });
    expect(planApply(state, [], options)).toEqual([]);
  });

  it("reset drops rows/windows including earlier pages and requires explicit page hydration", () => {
    const db = new Executor();
    db.windows = { post: [[1, 3]] };
    db.rows.set(key(row(1)), row(1));
    const pages: ScopePull[] = [
      { rows: [row(4)], cursor: 4, more: true },
      {
        rows: [row(5), row(1, 5, "setting")],
        cursor: 5,
        more: false,
        reset: ["post", "post", "setting"],
      },
    ];
    db.apply(planApply(db.state, pages, options));
    expect(db.windows.post).toEqual([]);
    expect([...db.rows.values()].map((item) => item.type)).toEqual(["setting"]);
    db.apply(
      mergePage(db.state, "post", [row(4), row(5)], {
        lo: 4,
        hi: 5,
        complete: true,
        seqOf,
      }),
    );
    expect(db.windows.post).toEqual([[4, 5]]);
    expect(db.cursor).toBe(5);
  });

  it("supports arbitrary type names without prototype inheritance", () => {
    const db = new Executor();
    db.apply(
      planApply(
        db.state,
        pull([row(1, 1, "constructor"), row(2, 2, "__proto__")]),
        { windowed: {} },
      ),
    );
    expect(db.rows.size).toBe(2);
    db.apply(
      mergePage(db.state, "__proto__", [], { lo: 1, hi: 3, complete: true }),
    );
    expect(Object.getPrototypeOf(db.windows)).toBe(Object.prototype);
    expect(db.windows.__proto__).toEqual([[1, 3]]);
  });

  it("history pages certify closed coverage only when complete, including empty ranges", () => {
    expect(
      mergePage(state, "post", [row(5)], { lo: 4, hi: 7, complete: false }),
    ).toEqual([]);
    expect(
      mergePage(state, "post", [], { lo: 4, hi: 7, complete: true }),
    ).toEqual([{ kind: "setWindow", type: "post", intervals: [[1, 10]] }]);
    expect(
      mergePage(state, "post", [row(5, 15, "post", true)], {
        lo: 4,
        hi: 7,
        complete: true,
      })[0],
    ).toEqual({
      kind: "delete",
      type: "post",
      id: "5",
      rev: 15,
      ifNewer: true,
    });
  });

  it("rejects malformed pages and cursor chains", () => {
    expect(() =>
      planApply({ ...state, cursor: 101 }, pull([]), options),
    ).toThrow(AppError);
    expect(() => planApply(state, [pull([]), pull([])], options)).toThrow(
      AppError,
    );
    expect(() => planApply(state, pull([row(1, 101)]), options)).toThrow(
      AppError,
    );
    expect(() =>
      planApply(state, pull([row(1)]), {
        windowed: { post: { seqOf: () => NaN } },
      }),
    ).toThrow(AppError);
    expect(() =>
      mergePage(state, "post", [row(1, 1, "other")], {
        lo: 1,
        hi: 1,
        complete: true,
      }),
    ).toThrow(AppError);
    expect(() =>
      mergePage(state, "post", [row(2)], {
        lo: 1,
        hi: 1,
        complete: true,
        seqOf,
      }),
    ).toThrow(AppError);
  });

  it("converges over seeded server histories, revision groups, pull sizes and disconnects", () => {
    const rng = random(1403);
    for (let run = 0; run < 120; run++) {
      const db = new Executor();
      const server = new Map<string, Row>();
      let rev = 10;
      let sequence = 10;
      db.cursor = 10;
      db.windows = {
        post: [
          [1, 4],
          [8, 10],
        ],
      };
      for (let n = 1; n <= 10; n++) {
        const item = row(n);
        server.set(key(item), item);
        if (new IntervalSet(db.windows.post).contains(n))
          db.rows.set(key(item), item);
      }
      for (let round = 0; round < 8; round++) {
        for (let transaction = 0; transaction < 15; transaction++) {
          rev++;
          for (let write = 0; write < 1 + rng(4); write++) {
            const kind = rng(3);
            const item =
              kind === 0
                ? row(++sequence, rev)
                : kind === 1
                  ? row(1 + rng(sequence), rev, "post", rng(3) === 0)
                  : row(rng(8), rev, "setting", rng(4) === 0);
            // Immutable tombstones cannot resurrect in the generated server truth.
            if (!server.get(key(item))?.deleted) server.set(key(item), item);
          }
        }
        const snapshot = [...server.values()].sort((a, b) => a.rev - b.rev);
        let pages: ScopePull[] = [];
        let cursor = db.cursor;
        let disconnects = 0;
        for (;;) {
          const page = selectDelta(snapshot, cursor, 1 + rng(9));
          pages.push(page);
          if (page.more) {
            expect(planApply(db.state, pages, options)).toEqual([]);
            if (rng(4) === 0 && disconnects < 3) {
              pages = [];
              cursor = db.cursor;
              disconnects++;
            } else cursor = page.cursor;
          } else {
            db.apply(planApply(db.state, pages, options));
            break;
          }
        }
        expect(db.windows.post).toEqual([
          [1, 4],
          [8, sequence],
        ]);
        for (const item of server.values()) {
          const expected =
            item.type !== "post" ||
            new IntervalSet(db.windows.post).contains(seqOf(item));
          const held = db.rows.get(key(item));
          if (!expected) expect(held).toBeUndefined();
          else {
            expect(held?.rev).toBe(item.rev);
            expect(held?.deleted).toBe(item.deleted);
            if (!item.deleted) expect(held?.data).toEqual(item.data);
          }
        }
      }
    }
  });
});

describe("server delta selection", () => {
  it("never splits a revision group and resumes exclusively after its cursor", () => {
    const rows = [row(1, 1), row(2, 2), row(3, 2), row(4, 2), row(5, 3)];
    const first = selectDelta(rows, 0, 2);
    expect(first).toEqual({ rows: rows.slice(0, 4), cursor: 2, more: true });
    expect(selectDelta(rows, first.cursor, 1)).toEqual({
      rows: [rows[4]],
      cursor: 3,
      more: false,
    });
    expect(selectDelta(rows, 100, 1)).toEqual({
      rows: [],
      cursor: 100,
      more: false,
    });
    expect(selectDelta([], 0, 1)).toEqual({ rows: [], cursor: 0, more: false });
  });

  it("rejects unsorted rows, invalid revisions, and invalid limits", () => {
    expect(() => selectDelta([row(2), row(1)], 0, 1)).toThrow(AppError);
    expect(() => selectDelta([row(1, -1)], 0, 1)).toThrow(AppError);
    for (const limit of [0, -1, NaN, Infinity, 0.5])
      expect(() => selectDelta([], 0, limit)).toThrow(AppError);
  });
});
