import { describe, expect, it } from "vitest";
import { ArraySource } from "../sources/array.ts";
import { Scroller } from "./scroller.ts";
import type { Request, Source, SourceEvent } from "./protocol.ts";

/**
 * Randomised model test: a world list with true item sizes, an asynchronous source (requests
 * answered late, its event stream delivered in batches but always in order), a simulated DOM
 * that measures whatever is rendered, and random user and source activity. Invariants are
 * checked after every step.
 */
interface Row {
  id: string;
  rev: number;
}
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class DelayedSource implements Source<Row> {
  readonly inner: ArraySource<Row>;
  outbox: Array<{ events: SourceEvent<Row>[]; list: string[] }> = [];
  requests: Request[] = [];
  known: string[];
  private batch: SourceEvent<Row>[] | undefined;
  private emit: (event: SourceEvent<Row>) => void = () => undefined;
  constructor(list: Row[], page: number) {
    this.inner = new ArraySource<Row>(
      { key: (row) => row.id, equals: (a, b) => a.rev === b.rev, page },
      list,
    );
    this.known = list.map((row) => row.id);
  }
  connect(emit: (event: SourceEvent<Row>) => void): () => void {
    this.emit = emit;
    return this.inner.connect((event) => {
      if (this.batch) this.batch.push(event);
      else this.outbox.push({ events: [event], list: this.ids() });
    });
  }
  request(request: Request): void {
    this.requests.push(request);
  }
  set(list: Row[]): void {
    this.collect(() => this.inner.set(list));
  }
  answer(index: number): void {
    const [request] = this.requests.splice(index, 1);
    this.collect(() => this.inner.request(request!));
  }
  deliver(): void {
    const batch = this.outbox.shift()!;
    this.known = batch.list;
    batch.events.forEach((event) => this.emit(event));
  }
  private ids(): string[] {
    return this.inner.list.map((row) => row.id);
  }
  private collect(run: () => void): void {
    this.batch = [];
    run();
    const events = this.batch;
    this.batch = undefined;
    if (events.length) this.outbox.push({ events, list: this.ids() });
  }
}

interface Internals {
  anchor: { kind: string; id?: string; offset?: number; align?: string };
  edges: Record<"before" | "after", { more: boolean; state: string }>;
  status: string;
  lead: number;
  sizes: { total: number };
}

const trace = Number(process.env.VIRTUAL_TRACE ?? -1);
function simulate(seed: number, steps: number): void {
  const rand = random(seed);
  const int = (min: number, max: number) =>
    min + Math.floor(rand() * (max - min + 1));
  const pick = <T>(list: readonly T[]): T => list[int(0, list.length - 1)]!;
  let counter = 0;
  const truth = new Map<string, number>();
  const make = (): Row => {
    const id = `w${counter++}`;
    truth.set(id, int(1, 4) === 1 ? int(100, 400) : int(16, 90));
    return { id, rev: 0 };
  };
  let world: Row[] = Array.from({ length: int(0, 150) }, make);
  const source = new DelayedSource(world, int(1, 4) === 1 ? 1000 : int(2, 25));
  const overscan = int(0, 300);
  const stickToEnd = rand() < 0.5;
  const maxItems = rand() < 0.4 ? int(25, 80) : Infinity;
  const scroller = new Scroller<Row>(source, {
    estimate: 40,
    overscan,
    stickToEnd,
    maxItems,
  });
  const inner = scroller as unknown as Internals;
  let viewport = int(200, 700);
  const reach = () => Math.max(overscan * 2, viewport);
  const context = () =>
    `seed ${seed} step ${step} op ${op} anchor ${JSON.stringify(inner.anchor)}`;
  let step = 0;
  let op = "start";

  const measure = (): void => {
    for (let pass = 0; pass < 30; pass++) {
      const version = scroller.getSnapshot().version;
      const geometry = scroller.geometry();
      if (trace === seed && step === Number(process.env.VIRTUAL_STEP))
        console.log(
          "pass",
          pass,
          geometry.top,
          JSON.stringify(inner.anchor),
          scroller
            .getSnapshot()
            .items.map(
              (e) => `${e.id}:${truth.get(e.id)}@${scroller.offsetOf(e.id)}`,
            )
            .join(" "),
        );
      scroller.sense({
        viewport,
        sizes: scroller
          .getSnapshot()
          .items.map((e) => [e.id, truth.get(e.id)!]),
      });
      if (
        scroller.getSnapshot().version === version &&
        scroller.geometry() === geometry
      )
        return;
    }
    throw new Error(`measurement did not settle: ${context()}`);
  };
  const check = (): void => {
    const view = scroller.getSnapshot();
    const geometry = scroller.geometry();
    const ids = scroller.ids();
    expect(new Set(ids).size, context()).toBe(ids.length);
    // The window is a contiguous slice of the source list, in order (a pending seek replaces it).
    if (ids.length && inner.status !== "seeking") {
      const at = source.known.indexOf(ids[0]!);
      expect(at, context()).toBeGreaterThanOrEqual(0);
      expect(source.known.slice(at, at + ids.length), context()).toEqual(ids);
      {
        if (!inner.edges.before.more)
          expect(source.known[0], context()).toBe(ids[0]);
        if (!inner.edges.after.more)
          expect(source.known[source.known.length - 1], context()).toBe(
            ids[ids.length - 1],
          );
      }
    }
    const total = inner.sizes.total;
    const max = Math.max(0, inner.lead + total - viewport);
    expect(geometry.top, context()).toBeGreaterThanOrEqual(0);
    expect(geometry.top, context()).toBeLessThanOrEqual(max + 1e-6);
    // Rendered items are measured and cover viewport plus overscan wherever items are loaded.
    let sum = 0;
    for (const entry of view.items) {
      expect(
        scroller.offsetOf(entry.id)! - geometry.itemsTop,
        context(),
      ).toBeCloseTo(sum, 6);
      sum += truth.get(entry.id)!;
    }
    const need = [
      Math.max(inner.lead, geometry.top - overscan),
      Math.min(inner.lead + total, geometry.top + viewport + overscan),
    ] as const;
    if (need[1] > need[0] + 1e-6) {
      expect(geometry.itemsTop, context()).toBeLessThanOrEqual(need[0] + 1e-6);
      expect(geometry.itemsTop + sum, context()).toBeGreaterThanOrEqual(
        need[1] - 1e-6,
      );
    }
  };
  /** Runs `change`; afterwards the anchor must sit where it was unless clamped or removed. */
  const anchored = (change: () => void): void => {
    const anchor = { ...inner.anchor };
    // An anchor held back by clamping is not where it wants to be; it may move towards it.
    const held =
      anchor.id !== undefined &&
      scroller.has(anchor.id) &&
      Math.abs(
        scroller.offsetOf(anchor.id)! -
          (anchor.offset ?? 0) -
          scroller.geometry().top,
      ) > 1e-6;
    change();
    measure();
    const geometry = scroller.geometry();
    const max = Math.max(0, inner.lead + inner.sizes.total - viewport);
    if (trace === seed)
      console.log(
        "anchored",
        JSON.stringify(anchor),
        "->",
        JSON.stringify(inner.anchor),
        "top",
        geometry.top,
        "max",
        max,
      );
    if (inner.status === "seeking" || held) return;
    // A sticky list that fit its viewport at some point is at its end, and follows it.
    if (stickToEnd && inner.anchor.kind === "end") return;
    if (anchor.kind === "end")
      expect(geometry.top, context()).toBeGreaterThanOrEqual(max - 4 - 1e-6);
    else if (
      (anchor.kind === "item" ||
        (anchor.kind === "align" && anchor.align === "start")) &&
      scroller.has(anchor.id!)
    ) {
      // The anchor's top stays where it was asked to be, unless that is out of range.
      const desired = scroller.offsetOf(anchor.id!)! - anchor.offset!;
      // An anchor that shrank out of view hands over to the next visible item.
      const visible =
        scroller.offsetOf(anchor.id!)! + truth.get(anchor.id!)! > geometry.top;
      if (visible && desired >= 0 && desired <= max - (stickToEnd ? 4 : 0))
        expect(geometry.top, context()).toBeCloseTo(desired, 6);
    }
  };
  const drain = (): void => {
    for (let round = 0; round < 500; round++) {
      if (!source.requests.length && !source.outbox.length) {
        measure();
        if (!source.requests.length) return;
      }
      while (source.requests.length) source.answer(0);
      while (source.outbox.length) source.deliver();
      measure();
    }
    throw new Error(`source never went quiet: ${context()}`);
  };

  void scroller.start(
    rand() < 0.3 || !world.length
      ? { edge: rand() < 0.5 ? "start" : "end" }
      : {
          id: pick(world).id,
          align: pick(["start", "center", "end"] as const),
        },
  );
  measure();
  for (step = 0; step < steps; step++) {
    const roll = rand();
    if (roll < 0.2) {
      op = "scroll";
      scroller.sense({ scrolledBy: (rand() * 3 - 1.5) * viewport });
      measure();
    } else if (roll < 0.32) {
      op = "resize items";
      anchored(() => {
        const loaded = scroller.ids();
        for (let i = int(1, 6); i > 0; i--) {
          const id =
            rand() < 0.7 && loaded.length
              ? pick(loaded)
              : world.length
                ? pick(world).id
                : undefined;
          if (id) truth.set(id, int(0, 4) === 0 ? 0 : int(10, 300));
        }
      });
    } else if (roll < 0.4) {
      op = "insert";
      const at = int(0, world.length);
      world = [
        ...world.slice(0, at),
        ...Array.from({ length: int(1, 8) }, make),
        ...world.slice(at),
      ];
      source.set(world);
    } else if (roll < 0.47) {
      op = "remove";
      const doomed = new Set(
        Array.from({ length: int(1, 6) }, () =>
          world.length ? pick(world).id : "",
        ),
      );
      world = world.filter((row) => !doomed.has(row.id));
      source.set(world);
    } else if (roll < 0.52) {
      op = "update";
      const changed = new Set(
        Array.from({ length: int(1, 6) }, () =>
          world.length ? pick(world).id : "",
        ),
      );
      world = world.map((row) =>
        changed.has(row.id) ? { ...row, rev: row.rev + 1 } : row,
      );
      source.set(world);
    } else if (roll < 0.53) {
      op = "reorder";
      world = world.slice().sort(() => rand() - 0.5);
      source.set(world);
    } else if (roll < 0.7) {
      op = "answer";
      if (source.requests.length)
        source.answer(int(0, source.requests.length - 1));
    } else if (roll < 0.86) {
      op = "deliver";
      const replaces = (batch: { events: SourceEvent<Row>[] }) =>
        batch.events.some(
          (event) => event.type === "seeked" || event.type === "invalidate",
        );
      if (source.outbox.length && replaces(source.outbox[0]!)) {
        source.deliver();
        measure();
      } else
        anchored(() => {
          for (
            let i = int(1, 3);
            i > 0 && source.outbox.length && !replaces(source.outbox[0]!);
            i--
          )
            source.deliver();
        });
    } else if (roll < 0.9) {
      op = "jump";
      void scroller.jump(
        rand() < 0.3 || !world.length
          ? { edge: rand() < 0.5 ? "start" : "end" }
          : {
              id: pick(world).id,
              align: pick(["start", "center", "end"] as const),
              offset: int(-20, 20),
            },
      );
      measure();
    } else if (roll < 0.93) {
      op = "viewport";
      viewport = int(150, 800);
      measure();
    } else if (roll < 0.96) {
      op = "release";
      scroller.release();
      measure();
    } else {
      op = "drain";
      drain();
      // Quiet: nothing is loading, and every end within reach that has more was asked for.
      expect(inner.edges.before.state, context()).toBe("idle");
      expect(inner.edges.after.state, context()).toBe("idle");
      expect(inner.status, context()).toBe(
        world.length || scroller.ids().length ? "ready" : inner.status,
      );
      const top = scroller.geometry().top;
      if (scroller.ids().length && viewport > 0) {
        if (inner.edges.before.more)
          expect(top - reach(), context()).toBeGreaterThanOrEqual(
            inner.lead - 1e-6,
          );
        if (inner.edges.after.more)
          expect(top + viewport + reach(), context()).toBeLessThanOrEqual(
            inner.lead + inner.sizes.total + 1e-6,
          );
      }
      if (inner.status === "ready")
        expect(scroller.ids().length > 0, context()).toBe(world.length > 0);
    }
    if (trace === seed)
      console.log(
        step,
        op,
        JSON.stringify(inner.anchor),
        inner.status,
        JSON.stringify(inner.edges),
        scroller.geometry().top.toFixed(2),
        scroller.ids().join(","),
        "| known",
        source.known.join(","),
      );
    check();
  }
  drain();
  check();
}

describe("scroller model", () => {
  if (process.env.VIRTUAL_SEED)
    it("replays one seed", () =>
      simulate(Number(process.env.VIRTUAL_SEED), 250));
  // VIRTUAL_BLOCKS widens the sweep when hunting rare interleavings.
  const blocks = Number(process.env.VIRTUAL_BLOCKS ?? 8);
  for (let block = 0; block < blocks; block++)
    it(`keeps its invariants under random activity (seeds ${block * 50}-${block * 50 + 49})`, () => {
      for (let seed = block * 50; seed < block * 50 + 50; seed++)
        simulate(seed, 250);
    });
});
