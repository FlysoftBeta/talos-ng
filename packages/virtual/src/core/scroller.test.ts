import { describe, expect, it } from "vitest";
import { ArraySource } from "../sources/array.ts";
import { Scroller } from "./scroller.ts";
import type { ScrollerOptions } from "./scroller.ts";
import type { Entry, Request, Source, SourceEvent } from "./protocol.ts";

interface Row {
  id: string;
  label: string;
}
const rows = (from: number, to: number): Row[] =>
  Array.from({ length: to - from }, (_, i) => ({
    id: `r${from + i}`,
    label: `row ${from + i}`,
  }));
const entries = (list: Row[]): Entry<Row>[] =>
  list.map((item) => ({ id: item.id, item }));

/** A source answering only when the test says so. */
class ManualSource implements Source<Row, string> {
  emit: (event: SourceEvent<Row>) => void = () => undefined;
  requests: Request<string>[] = [];
  connect(emit: (event: SourceEvent<Row>) => void): () => void {
    this.emit = emit;
    return () => undefined;
  }
  request(request: Request<string>): void {
    this.requests.push(request);
  }
  take(kind: Request<string>["kind"], direction?: string): Request<string> {
    const index = this.requests.findIndex(
      (request) =>
        request.kind === kind &&
        (direction === undefined ||
          (request.kind === "extend" && request.direction === direction)),
    );
    if (index < 0) throw new Error(`no pending ${kind} ${direction ?? ""}`);
    return this.requests.splice(index, 1)[0]!;
  }
}

/** Plays the DOM: true sizes per id, measured for whatever is rendered. */
function harness<L = never>(
  source: Source<Row, L>,
  options: ScrollerOptions = {},
  viewport = 500,
) {
  const scroller = new Scroller<Row, L>(source, {
    estimate: 50,
    overscan: 100,
    ...options,
  });
  const truth = new Map<string, number>();
  const sizeOf = (id: string) => truth.get(id) ?? 50;
  const measure = (): void => {
    for (let pass = 0; pass < 20; pass++) {
      const before = scroller.getSnapshot().version;
      scroller.sense({
        viewport,
        width: 400,
        sizes: scroller.getSnapshot().items.map((e) => [e.id, sizeOf(e.id)]),
      });
      if (scroller.getSnapshot().version === before) return;
    }
    throw new Error("measurement did not settle");
  };
  /** Viewport offset of an item's top. */
  const offset = (id: string): number =>
    scroller.offsetOf(id)! - scroller.geometry().top;
  const rendered = (): string[] =>
    scroller.getSnapshot().items.map((e) => e.id);
  return { scroller, truth, measure, offset, rendered };
}
const local = (list: Row[], page?: number) =>
  new ArraySource<Row>(
    { key: (row) => row.id, ...(page ? { page } : {}) },
    list,
  );

describe("anchoring", () => {
  it("lands on a seeked id and renders only the viewport plus overscan", async () => {
    const h = harness(local(rows(0, 1000)));
    expect(await h.scroller.start({ id: "r500" })).toBe("done");
    h.measure();
    expect(h.offset("r500")).toBe(0);
    const ids = h.rendered();
    expect(ids[0]).toBe("r498");
    expect(ids[ids.length - 1]).toBe("r512");
    expect(h.scroller.getSnapshot().count).toBe(1000);
    expect(h.scroller.visible().map((v) => v.id)).toEqual(
      rows(500, 510).map((r) => r.id),
    );
  });

  it("keeps the first visible item in place when items above it change size", async () => {
    const h = harness(local(rows(0, 100)));
    await h.scroller.start({ id: "r50" });
    h.measure();
    h.scroller.sense({ scrolledBy: 20 });
    expect(h.scroller.position()).toEqual({ id: "r50", offset: -20 });
    const top = h.scroller.geometry().top;
    h.truth.set("r49", 130);
    h.truth.set("r48", 10);
    h.measure();
    expect(h.offset("r50")).toBe(-20);
    expect(h.scroller.geometry().top).toBe(top + 80 - 40);
  });

  it("lets the anchor item grow downwards and pushes only the items below", async () => {
    const h = harness(local(rows(0, 100)));
    await h.scroller.start({ id: "r50" });
    h.measure();
    h.scroller.sense({ scrolledBy: 20 });
    const before = h.offset("r52");
    const top = h.scroller.geometry().top;
    h.truth.set("r50", 250);
    h.measure();
    expect(h.offset("r50")).toBe(-20);
    expect(h.offset("r52")).toBe(before + 200);
    expect(h.scroller.geometry().top).toBe(top);
  });

  it("follows an expansion animation frame by frame without moving the anchor", async () => {
    const h = harness(local(rows(0, 100)));
    await h.scroller.start({ id: "r40" });
    h.measure();
    h.scroller.release();
    expect(h.scroller.position()).toEqual({ id: "r40", offset: 0 });
    for (let frame = 1; frame <= 12; frame++) {
      h.truth.set("r39", 50 + frame * 15);
      h.truth.set("r41", 50 + frame * 10);
      h.measure();
      expect(h.offset("r40")).toBe(0);
      expect(h.offset("r41")).toBe(50);
      expect(h.offset("r42")).toBe(100 + frame * 10);
    }
  });

  it("clamps at the end when content below the anchor shrinks", async () => {
    const h = harness(local(rows(0, 100)));
    await h.scroller.start({ id: "r95" });
    h.measure();
    expect(h.scroller.geometry().top).toBe(4500);
    expect(h.offset("r95")).toBe(250);
    h.truth.set("r99", 10);
    h.measure();
    expect(h.scroller.geometry().top).toBe(4460);
    expect(h.scroller.position()).toEqual({ id: "r89", offset: -10 });
  });

  it("moves the anchor to the next item when it is removed", async () => {
    const source = local(rows(0, 100));
    const h = harness(source);
    await h.scroller.start({ id: "r50" });
    h.measure();
    h.scroller.sense({ scrolledBy: 10 });
    source.set(rows(0, 100).filter((r) => r.id !== "r50" && r.id !== "r51"));
    h.measure();
    expect(h.scroller.position()).toEqual({ id: "r52", offset: -10 });
    expect(h.offset("r49")).toBe(-60);
  });

  it("keeps the viewport when items are inserted above or below", async () => {
    const source = local(rows(0, 100));
    const h = harness(source);
    await h.scroller.start({ id: "r50" });
    h.measure();
    h.scroller.release();
    const next = rows(0, 100);
    next.splice(30, 0, ...rows(1000, 1010));
    next.splice(70, 0, ...rows(2000, 2003));
    source.set(next);
    h.measure();
    expect(h.offset("r50")).toBe(0);
    expect(h.scroller.getSnapshot().count).toBe(113);
    // r50..r59, then the three items inserted before r60.
    expect(h.offset("r60")).toBe(13 * 50);
  });
});

describe("programmatic placement", () => {
  it("keeps a centered target centered while its size settles, until released", async () => {
    const h = harness(local(rows(0, 100)));
    await h.scroller.start({ id: "r60", align: "center" });
    h.measure();
    expect(h.offset("r60")).toBe(225);
    h.truth.set("r60", 150);
    h.truth.set("r58", 300);
    h.measure();
    expect(h.offset("r60")).toBe(175);
    h.scroller.release();
    h.truth.set("r60", 350);
    h.measure();
    expect(h.offset("r60")).toBe(175);
  });

  it("aligns the end of a target and the edges", async () => {
    const h = harness(local(rows(0, 100)));
    await h.scroller.start({ id: "r60", align: "end", offset: 8 });
    h.measure();
    expect(h.offset("r60")).toBe(500 - 50 - 8);
    expect(await h.scroller.jump({ edge: "end" })).toBe("done");
    h.measure();
    expect(h.scroller.geometry().top).toBe(100 * 50 - 500);
    expect(h.scroller.getSnapshot().atEnd).toBe(true);
    await h.scroller.jump({ edge: "start" });
    h.measure();
    expect(h.scroller.geometry().top).toBe(0);
    expect(h.scroller.getSnapshot().atStart).toBe(true);
  });

  it("ends the placement on user scroll", async () => {
    const h = harness(local(rows(0, 100)));
    await h.scroller.start({ id: "r60", align: "center" });
    h.measure();
    h.scroller.sense({ scrolledBy: -30 });
    const offset = h.offset("r60");
    h.truth.set("r60", 200);
    h.measure();
    expect(h.offset("r60")).toBe(offset);
  });
});

describe("loading at the edges", () => {
  it("extends both ways from a seek in the middle", async () => {
    const source = local(rows(0, 400), 20);
    const h = harness(source);
    await h.scroller.start({ id: "r200" });
    h.measure();
    const loaded = h.scroller.ids();
    expect(loaded.length).toBeGreaterThan(20);
    expect(loaded.length).toBeLessThan(100);
    expect(h.offset("r200")).toBe(0);
    expect(h.scroller.getSnapshot().before.more).toBe(true);
    // Scroll to the top of the loaded window: it grows upwards, the view does not move.
    for (let i = 0; i < 40; i++) {
      h.scroller.sense({ scrolledBy: -h.scroller.geometry().top });
      h.measure();
    }
    expect(h.scroller.ids()[0]).toBe("r0");
    expect(h.scroller.getSnapshot().before.more).toBe(false);
    expect(h.scroller.geometry().top).toBe(0);
    for (let i = 0; i < 60; i++) {
      h.scroller.sense({ scrolledBy: 100000 });
      h.measure();
    }
    expect(h.scroller.ids()).toEqual(rows(0, 400).map((r) => r.id));
    expect(h.scroller.getSnapshot().atEnd).toBe(true);
  });

  it("keeps the view still while older items arrive asynchronously", async () => {
    const source = new ManualSource();
    const h = harness(source);
    const started = h.scroller.start({ key: "middle" });
    const seek = source.take("seek");
    source.emit({
      type: "seeked",
      token: seek.token,
      items: entries(rows(100, 130)),
      before: true,
      after: false,
      focus: "r105",
    });
    expect(await started).toBe("done");
    h.measure();
    expect(h.offset("r105")).toBe(0);
    h.scroller.release();
    const extend = source.take("extend", "before");
    expect(extend).toMatchObject({ from: "r100" });
    h.scroller.sense({ scrolledBy: -40 });
    const anchor = h.scroller.position()!;
    source.emit({
      type: "extended",
      token: extend.token,
      items: entries(rows(90, 100)),
      more: true,
    });
    h.measure();
    expect(h.scroller.position()).toEqual(anchor);
    expect(h.scroller.ids()[0]).toBe("r90");
  });

  it("drops replies that a newer seek made stale", async () => {
    const source = new ManualSource();
    const h = harness(source);
    void h.scroller.start({ id: "r10" });
    const first = source.take("seek");
    const second = h.scroller.jump({ id: "r500" });
    const latest = source.take("seek");
    source.emit({
      type: "seeked",
      token: first.token,
      items: entries(rows(0, 20)),
      before: false,
      after: true,
      focus: "r10",
    });
    expect(h.scroller.getSnapshot().count).toBe(0);
    source.emit({
      type: "seeked",
      token: latest.token,
      items: entries(rows(495, 505)),
      before: true,
      after: true,
    });
    expect(await second).toBe("done");
    h.measure();
    const extend = source.take("extend", "before");
    void h.scroller.jump({ id: "r9000" });
    source.emit({
      type: "extended",
      token: extend.token,
      items: entries(rows(485, 495)),
      more: true,
    });
    expect(h.scroller.ids()[0]).toBe("r495");
  });

  it("marks a failed end and asks again only after retry or a new 'more'", async () => {
    const source = new ManualSource();
    const h = harness(source);
    void h.scroller.start({ edge: "end" });
    source.emit({
      type: "seeked",
      token: source.take("seek").token,
      items: entries(rows(0, 5)),
      before: true,
      after: false,
    });
    h.measure();
    const extend = source.take("extend", "before");
    source.emit({ type: "failed", token: extend.token, error: "offline" });
    h.measure();
    expect(h.scroller.getSnapshot().before).toEqual({
      more: true,
      state: "failed",
      error: "offline",
    });
    h.scroller.sense({ scrolledBy: -10 });
    expect(source.requests).toEqual([]);
    h.scroller.retry();
    source.emit({
      type: "failed",
      token: source.take("extend", "before").token,
      error: "offline",
    });
    source.emit({ type: "more", direction: "before", more: true });
    expect(source.take("extend", "before")).toMatchObject({ from: "r0" });
  });

  it("treats an empty reply that still claims more as a failure, not a loop", async () => {
    const source = new ManualSource();
    const h = harness(source);
    void h.scroller.start({ edge: "start" });
    source.emit({
      type: "seeked",
      token: source.take("seek").token,
      items: entries(rows(0, 3)),
      before: false,
      after: true,
    });
    h.measure();
    source.emit({
      type: "extended",
      token: source.take("extend", "after").token,
      items: [],
      more: true,
    });
    h.measure();
    expect(h.scroller.getSnapshot().after.state).toBe("failed");
    expect(source.requests).toEqual([]);
  });

  it("releases the far side beyond maxItems and reloads it on return", async () => {
    const source = local(rows(0, 1000), 25);
    const h = harness(source, { maxItems: 120 });
    await h.scroller.start({ edge: "start" });
    h.measure();
    for (let i = 0; i < 80; i++) {
      h.scroller.sense({ scrolledBy: 400 });
      h.measure();
      expect(h.scroller.getSnapshot().count).toBeLessThanOrEqual(120);
    }
    expect(h.scroller.ids()[0]).not.toBe("r0");
    expect(h.scroller.getSnapshot().before.more).toBe(true);
    const anchor = h.scroller.position()!;
    expect(h.offset(anchor.id)).toBe(anchor.offset);
    for (let i = 0; i < 200 && h.scroller.geometry().top > 0; i++) {
      h.scroller.sense({ scrolledBy: -400 });
      h.measure();
    }
    expect(h.scroller.ids()[0]).toBe("r0");
  });
});

describe("source changes", () => {
  it("applies inserts only next to loaded ids or at a reached end", async () => {
    const source = new ManualSource();
    const h = harness(source, { stickToEnd: false });
    void h.scroller.start({ id: "r5" });
    source.emit({
      type: "seeked",
      token: source.take("seek").token,
      items: entries(rows(0, 10)),
      before: false,
      after: true,
      focus: "r5",
    });
    h.measure();
    source.requests = [];
    const one = (id: string) => entries([{ id, label: id }]);
    source.emit({ type: "insert", place: "start", items: one("s") });
    source.emit({ type: "insert", place: "end", items: one("e") });
    source.emit({ type: "insert", place: { after: "r3" }, items: one("a") });
    source.emit({ type: "insert", place: { before: "r3" }, items: one("b") });
    source.emit({ type: "insert", place: { after: "zz" }, items: one("x") });
    expect(h.scroller.ids()).toEqual([
      "s",
      "r0",
      "r1",
      "r2",
      "b",
      "r3",
      "a",
      "r4",
      "r5",
      "r6",
      "r7",
      "r8",
      "r9",
    ]);
    // An insert of a loaded id is an update, never a duplicate.
    source.emit({
      type: "insert",
      place: { after: "r9" },
      items: [{ id: "r1", item: { id: "r1", label: "new" } }],
    });
    expect(h.scroller.ids().filter((id) => id === "r1")).toHaveLength(1);
  });

  it("reloads around the anchor on invalidate, keeping its offset", async () => {
    const source = local(rows(0, 100));
    const h = harness(source);
    await h.scroller.start({ id: "r40" });
    h.measure();
    h.scroller.sense({ scrolledBy: 15 });
    const reversed = rows(0, 100).reverse();
    source.set(reversed);
    h.measure();
    expect(h.scroller.ids()[0]).toBe("r99");
    expect(h.offset("r40")).toBe(-15);
  });

  it("processes synchronous replies emitted from inside a request in order", async () => {
    const order: string[] = [];
    const inner = local(rows(0, 200), 10);
    const source: Source<Row> = {
      connect: (emit) =>
        inner.connect((event) => {
          order.push(event.type);
          emit(event);
        }),
      request: (request) => inner.request(request),
    };
    const h = harness(source);
    await h.scroller.start({ id: "r100" });
    h.measure();
    expect(order[0]).toBe("seeked");
    expect(order.filter((type) => type === "extended").length).toBeGreaterThan(
      1,
    );
    const ids = h.scroller.ids();
    expect(ids).toEqual(
      rows(
        Number(ids[0]!.slice(1)),
        Number(ids[ids.length - 1]!.slice(1)) + 1,
      ).map((r) => r.id),
    );
  });

  it("reports a missing target and keeps the current view", async () => {
    const source = new ArraySource<Row, string>(
      { key: (row) => row.id, locate: () => undefined },
      rows(0, 100),
    );
    const h = harness(source);
    await h.scroller.start({ id: "r30" });
    h.measure();
    h.scroller.sense({ scrolledBy: 12 });
    expect(await h.scroller.jump({ key: "nowhere" })).toBe("missing");
    h.measure();
    expect(h.scroller.position()).toEqual({ id: "r30", offset: -12 });
  });
});

describe("following the end", () => {
  it("follows appended and growing items while at the end, not after scrolling up", async () => {
    const list = rows(0, 30);
    const source = local(list);
    const h = harness(source, { stickToEnd: true });
    await h.scroller.start({ edge: "end" });
    h.measure();
    const bottom = () =>
      h.scroller.geometry().height -
      h.scroller.geometry().top -
      h.scroller.geometry().viewport;
    expect(bottom()).toBe(0);
    source.set([...list, ...rows(30, 33)]);
    h.measure();
    expect(bottom()).toBe(0);
    expect(h.scroller.visible().pop()!.id).toBe("r32");
    h.truth.set("r32", 400);
    h.measure();
    expect(bottom()).toBe(0);
    h.truth.set("r20", 120);
    h.measure();
    expect(bottom()).toBe(0);
    h.scroller.sense({ scrolledBy: -200 });
    const anchor = h.scroller.position()!;
    source.set([...list, ...rows(30, 40)]);
    h.measure();
    expect(h.scroller.position()).toEqual(anchor);
    expect(h.scroller.getSnapshot().atEnd).toBe(false);
  });

  it("does not pull a small user scroll back to the end, but returns there when content grows", async () => {
    const list = rows(0, 30);
    const source = local(list);
    const h = harness(source, { stickToEnd: true, endThreshold: 80 });
    await h.scroller.start({ edge: "end" });
    h.measure();
    const max = () =>
      h.scroller.geometry().height - h.scroller.geometry().viewport;
    h.scroller.sense({ scrolledBy: -50 });
    h.measure();
    expect(h.scroller.geometry().top).toBe(max() - 50);
    h.truth.set("r29", 90);
    h.measure();
    expect(h.scroller.geometry().top).toBe(max());
    h.scroller.sense({ scrolledBy: -120 });
    source.set([...list, ...rows(30, 32)]);
    h.measure();
    expect(h.scroller.geometry().top).toBe(max() - 120 - 100);
  });

  it("keeps following while newer items load asynchronously", async () => {
    const source = new ManualSource();
    const h = harness(source, { stickToEnd: true });
    void h.scroller.start({ edge: "end" });
    source.emit({
      type: "seeked",
      token: source.take("seek").token,
      items: entries(rows(0, 20)),
      before: false,
      after: false,
    });
    h.measure();
    source.emit({ type: "more", direction: "after", more: true });
    const extend = source.take("extend", "after");
    source.emit({
      type: "extended",
      token: extend.token,
      items: entries(rows(20, 22)),
      more: false,
    });
    h.measure();
    expect(h.scroller.visible().pop()!.id).toBe("r21");
    expect(h.scroller.getSnapshot().atEnd).toBe(true);
  });
});

describe("view facts", () => {
  it("forgets remembered sizes when the width changes", async () => {
    const h = harness(local(rows(0, 100)));
    await h.scroller.start({ edge: "start" });
    h.truth.set("r0", 90);
    h.measure();
    expect(h.scroller.offsetOf("r1")).toBe(90);
    h.scroller.sense({ width: 300, sizes: [["r0", 70]] });
    expect(h.scroller.offsetOf("r1")).toBe(70);
  });

  it("counts edge slots in the layout", async () => {
    const source = local(rows(0, 50), 10);
    const h = harness(source);
    await h.scroller.start({ id: "r20" });
    h.measure();
    const top = h.scroller.geometry().top;
    h.scroller.sense({ before: 40, after: 30 });
    expect(h.offset("r20")).toBe(0);
    expect(h.scroller.geometry().top).toBe(top + 40);
    expect(h.scroller.geometry().afterTop).toBe(
      40 + h.scroller.getSnapshot().count * 50,
    );
  });
});
