import { AppError } from "@talos/base";
import { describe, expect, it } from "vitest";
import { random } from "../test/random.ts";
import { selectDelta } from "./delta.ts";
import type { Row, ScopePull } from "./delta.ts";
import {
  EMPTY_REPLICA,
  cursorOf,
  holdsWindow,
  holes,
  isComplete,
  mergeReplica,
  rowKey,
} from "./replica.ts";
import type { Inbound, Replica } from "./replica.ts";

const seqOf = (row: Row): number => (row.data as { seq: number }).seq;
const windowed = { post: { seqOf } };
const post = (seq: number, rev: number, deleted = false): Row => ({
  type: "post",
  id: `p${seq}`,
  rev,
  deleted,
  data: { seq, v: rev },
});
const fold = (inputs: readonly Inbound[], from = EMPTY_REPLICA): Replica =>
  inputs.reduce(
    (replica, input) => mergeReplica(replica, input, windowed),
    from,
  );
const chain = (
  from: number,
  cursor: number,
  rows: readonly Row[],
  extra: Partial<ScopePull> = { windowed: true },
): Inbound => ({
  kind: "chain",
  from,
  pages: [{ rows, cursor, more: false, ...extra }],
});

describe("scope replica merge", () => {
  it("keeps the run a pull delivers between two windows, whatever arrives first", () => {
    // Window 1..10 at revision 10; posts 11..20 are written at 11..20. A history
    // page of the newest posts and the pull carrying all of them race.
    const base = fold([
      chain(0, 10, [], {}),
      {
        kind: "page",
        type: "post",
        rows: Array.from({ length: 10 }, (_, i) => post(i + 1, i + 1)),
        lo: 1,
        hi: 10,
        rev: 10,
      },
    ]);
    const newer = Array.from({ length: 10 }, (_, i) => post(i + 11, i + 11));
    const pull = chain(10, 20, newer);
    const page: Inbound = {
      kind: "page",
      type: "post",
      rows: newer.slice(4),
      lo: 15,
      hi: 20,
      rev: 20,
    };
    const one = fold([page, pull], base);
    expect(fold([pull, page], base)).toEqual(one);
    expect(fold([pull, page, pull, page], base)).toEqual(one);
    expect(one.rows.size).toBe(20);
    expect(holes(one.coverage, "post", 1, 20)).toEqual([]);
    expect(cursorOf(one.coverage)).toBe(20);
  });

  it("certifies a page only through revisions whose changes arrived", () => {
    // The pull ran without windowed rows (the scope held no window when it was
    // requested), so the post edited at 7 never arrived; the page read at 5 is stale.
    const replica = fold([
      { kind: "page", type: "post", rows: [post(1, 3)], lo: 1, hi: 2, rev: 5 },
      chain(0, 9, [], {}),
    ]);
    expect(holdsWindow(replica.coverage)).toBe(true);
    expect(holes(replica.coverage, "post", 1, 3)).toEqual([[1, 3]]);
    // A pull with windowed rows from 9 does not repair 6..9; a fresh page does.
    const later = fold([chain(9, 12, [post(3, 11)])], replica);
    expect(holes(later.coverage, "post", 1, 3)).toEqual([[1, 2]]);
    const repaired = fold(
      [
        {
          kind: "page",
          type: "post",
          rows: [post(1, 7)],
          lo: 1,
          hi: 2,
          rev: 12,
        },
      ],
      later,
    );
    expect(holes(repaired.coverage, "post", 1, 3)).toEqual([]);
  });

  it("turns resets, evictions and revocations into explicit holes", () => {
    const replica = fold([
      chain(0, 4, [post(1, 1), post(2, 2), post(3, 3), post(4, 4)]),
    ]);
    expect(holes(replica.coverage, "post", 1, 4)).toEqual([]);
    const reset = fold(
      [chain(4, 9, [], { windowed: true, reset: ["post"] })],
      replica,
    );
    expect(holes(reset.coverage, "post", 1, 4)).toEqual([[1, 4]]);
    expect(reset.rows.size).toBe(4);
    const evicted = fold(
      [{ kind: "evict", type: "post", ids: ["p2"] }],
      replica,
    );
    expect(evicted.rows.has(rowKey("post", "p2"))).toBe(false);
    expect(holes(evicted.coverage, "post", 1, 4)).toEqual([[2, 2]]);
    const purged = fold([{ kind: "purge" }], replica);
    expect(purged.rows.size).toBe(0);
    expect(isComplete(purged.coverage)).toBe(false);
  });

  it("never resurrects a windowed tombstone but lets mirrored rows return", () => {
    const setting = (rev: number, deleted: boolean): Row => ({
      type: "setting",
      id: "s",
      rev,
      deleted,
      data: null,
    });
    const replica = fold([
      { kind: "rows", rows: [post(1, 5, true), setting(5, true)] },
      { kind: "rows", rows: [post(1, 9), setting(9, false)] },
    ]);
    expect(replica.rows.get(rowKey("post", "p1"))?.deleted).toBe(true);
    expect(replica.rows.get(rowKey("setting", "s"))?.deleted).toBe(false);
  });

  it("rejects malformed chains and pages", () => {
    const bad: Inbound[] = [
      { kind: "chain", from: 0, pages: [] },
      { kind: "chain", from: 0, pages: [{ rows: [], cursor: 3, more: true }] },
      chain(0, 1, [post(1, 2)]),
      {
        kind: "chain",
        from: 0,
        pages: [
          { rows: [], cursor: 3, more: true },
          { rows: [], cursor: 2, more: false },
        ],
      },
      { kind: "page", type: "post", rows: [post(5, 1)], lo: 1, hi: 4, rev: 9 },
      { kind: "page", type: "post", rows: [post(1, 10)], lo: 1, hi: 4, rev: 9 },
      { kind: "page", type: "setting", rows: [], lo: 1, hi: 4, rev: 9 },
    ];
    for (const input of bad)
      expect(() => mergeReplica(EMPTY_REPLICA, input, windowed)).toThrow(
        AppError,
      );
  });
});

/** Every version the server ever wrote; the state at t is the newest version <= t. */
class Server {
  rev = 0;
  maxSeq = 0;
  private readonly log: Row[] = [];
  constructor(private readonly rng: (max: number) => number) {}
  state(t = this.rev): Map<string, Row> {
    const state = new Map<string, Row>();
    for (const row of this.log)
      if (row.rev <= t) state.set(rowKey(row.type, row.id), row);
    return state;
  }
  /** One transaction of one to three writes at a new revision. */
  write(): Row[] {
    const rev = ++this.rev;
    const current = this.state();
    const written = new Map<string, Row>();
    for (let n = 1 + this.rng(3); n > 0; n--) {
      const live = [...current.values()].filter(
        (row) => row.type === "post" && !row.deleted,
      );
      const kind = this.rng(5);
      let row: Row;
      if (kind < 2 || !live.length) row = post(++this.maxSeq, rev);
      else if (kind < 4) {
        const target = seqOf(live[this.rng(live.length)]!);
        row = post(target, rev, kind === 3);
      } else
        row = {
          type: "item",
          id: `i${this.rng(5)}`,
          rev,
          deleted: this.rng(3) === 0,
          data: { v: rev },
        };
      written.set(rowKey(row.type, row.id), row);
      current.set(rowKey(row.type, row.id), row);
    }
    this.log.push(...written.values());
    return [...written.values()];
  }
  /** A pull chain from `from`, paged with random limits; resets busy windows. */
  pull(from: number, held: boolean): ScopePull[] {
    let rows = [...this.state().values()]
      .filter((row) => row.rev > from && (held || row.type !== "post"))
      .sort((a, b) => a.rev - b.rev);
    const reset = held && rows.filter((row) => row.type === "post").length > 12;
    if (reset) rows = rows.filter((row) => row.type !== "post");
    const pages: ScopePull[] = [];
    let cursor = from;
    for (;;) {
      const page = selectDelta(rows, cursor, 1 + this.rng(6));
      cursor = page.cursor;
      pages.push({
        ...page,
        cursor: page.more ? page.cursor : this.rev,
        windowed: held,
        ...(reset ? { reset: ["post"] } : {}),
      });
      if (!page.more) return pages;
    }
  }
  page(lo: number, hi: number): Inbound {
    const top = Math.min(hi, this.maxSeq);
    return {
      kind: "page",
      type: "post",
      rows: [...this.state().values()].filter(
        (row) => row.type === "post" && seqOf(row) >= lo && seqOf(row) <= top,
      ),
      lo,
      hi: Math.max(top, lo - 1),
      rev: this.rev,
    };
  }
}

interface Tab {
  /** Answers produced by the server but not merged yet, delivered in random order. */
  queue: Inbound[];
  /** Where the server's push stream to this tab continues, once subscribed. */
  served?: number;
  windowed?: boolean;
}

/**
 * Randomized interleavings of server writes, pulls, window pages, gap backfills,
 * write results, pushed deltas to two tabs, evictions and reloads, merged in random
 * order into one shared replica.
 */
function simulate(seed: number, steps: number, evictions: boolean) {
  const rng = random(seed);
  const server = new Server(rng);
  const tabs: Tab[] = [{ queue: [] }, { queue: [] }];
  const merged: Inbound[] = [];
  let replica = EMPTY_REPLICA;
  const merge = (input: Inbound): void => {
    replica = mergeReplica(replica, input, windowed);
    if (input.kind !== "evict") merged.push(input);
  };
  const write = (): Row[] => {
    const rows = server.write();
    for (const tab of tabs) {
      if (tab.served === undefined) continue;
      const pushed = rows.filter((row) => tab.windowed || row.type !== "post");
      if (!pushed.length) continue;
      tab.queue.push({
        kind: "chain",
        from: tab.served,
        pages: [
          {
            rows: pushed,
            cursor: server.rev,
            more: false,
            windowed: tab.windowed === true,
          },
        ],
      });
      tab.served = server.rev;
    }
    return rows;
  };
  const pull = (tab: Tab): void => {
    const held = holdsWindow(replica.coverage);
    tab.queue.push({
      kind: "chain",
      from: cursorOf(replica.coverage),
      pages: server.pull(cursorOf(replica.coverage), held),
    });
    tab.served = server.rev;
    tab.windowed = held;
  };
  const check = (): void => {
    const cursor = cursorOf(replica.coverage);
    for (const [key, row] of server.state(cursor)) {
      if (
        row.type === "post" &&
        holes(replica.coverage, "post", seqOf(row), seqOf(row)).length
      )
        continue;
      const held = replica.rows.get(key);
      expect(held, `${key} at ${cursor} (seed ${seed})`).toBeDefined();
      expect(held!.rev).toBeGreaterThanOrEqual(row.rev);
      if (row.deleted && row.type === "post") expect(held!.deleted).toBe(true);
    }
  };
  for (let step = 0; step < steps; step++) {
    const tab = tabs[rng(2)]!;
    const action = rng(evictions ? 12 : 10);
    if (action < 3) write();
    else if (action < 4) pull(tab);
    else if (action < 5) {
      // The newest posts, or older history, as an open conversation pages them.
      const hi = server.maxSeq - rng(Math.max(1, server.maxSeq));
      tab.queue.push(server.page(Math.max(1, hi - rng(6)), hi));
    } else if (action < 6) {
      // Visible hole backfill: the first hole of the stored extent.
      const hole = holes(replica.coverage, "post", 1, server.maxSeq)[0];
      if (hole) tab.queue.push(server.page(hole[0], hole[1]));
    } else if (action < 7) {
      const rows = write().filter((row) => row.type === "post");
      if (rows.length) tab.queue.push({ kind: "rows", rows });
    } else if (action < 10) {
      if (tab.queue.length)
        merge(tab.queue.splice(rng(tab.queue.length), 1)[0]!);
    } else if (action < 11) {
      const stored = [...replica.rows.values()].filter(
        (row) => row.type === "post",
      );
      const victims = stored.filter(() => rng(3) === 0).map((row) => row.id);
      merge({ kind: "evict", type: "post", ids: victims });
    } else {
      tab.queue = [];
      delete tab.served;
      delete tab.windowed;
    }
    check();
  }
  // Quiesce: deliver what is in flight, then pull and backfill until no hole is left.
  for (const tab of tabs) while (tab.queue.length) merge(tab.queue.shift()!);
  check();
  for (let round = 0; round < 4; round++) {
    pull(tabs[0]!);
    merge(tabs[0]!.queue.pop()!);
    for (const [lo, hi] of holes(replica.coverage, "post", 1, server.maxSeq))
      merge(server.page(lo, hi));
    check();
  }
  return { server, replica, merged, rng };
}

describe("replica merge under randomized interleavings", () => {
  it(
    "keeps every server row stored or inside a known hole, and converges",
    { timeout: 60_000 },
    () => {
      for (let seed = 1; seed <= 150; seed++) {
        const { server, replica } = simulate(seed, 160, true);
        expect(cursorOf(replica.coverage)).toBe(server.rev);
        expect(holes(replica.coverage, "post", 1, server.maxSeq)).toEqual([]);
        expect(new Map(replica.rows)).toEqual(server.state());
      }
    },
  );

  it(
    "reaches the same replica for any merge order and any repetition",
    { timeout: 60_000 },
    () => {
      for (let seed = 1001; seed <= 1150; seed++) {
        const { replica, merged, rng } = simulate(seed, 160, false);
        const shuffled = merged.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = rng(i + 1);
          [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
        }
        const repeated: Inbound[] = [];
        for (const input of shuffled)
          repeated.push(...(rng(4) === 0 ? [input, input] : [input]));
        expect(fold(repeated), `seed ${seed}`).toEqual(replica);
      }
    },
  );
});
