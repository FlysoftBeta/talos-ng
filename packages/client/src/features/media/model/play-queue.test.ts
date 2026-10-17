import { describe, expect, it } from "vitest";
import {
  advance,
  contextCurrent,
  jumpUpcoming,
  moveUpcoming,
  openContext,
  removeUpcoming,
  retreat,
  upcoming,
  withShuffle,
} from "./play-queue.ts";
import type { Flow, PlayContext, Repeat } from "./play-queue.ts";

/** A deterministic "random": always the smallest value, which reverses the tail. */
const low = () => 0;
const ids = ["a", "b", "c", "d"];
const ctx = (start = "a", shuffle = false) =>
  openContext("专辑", ids, start, shuffle, low);
const flow = (
  context: PlayContext | null,
  queue: string[] = [],
  repeat: Repeat = "off",
): Flow => ({ context, queue, repeat });
/** Plays through with auto-advance until nothing follows (bounded). */
function playOut(f: Flow, current: string, limit = 20): string[] {
  const out = [current];
  let state = f;
  for (let i = 0; i < limit; i++) {
    const step = advance(state, true, out.at(-1)!, low);
    if (step.id === null) break;
    out.push(step.id);
    state = { ...state, context: step.context, queue: step.queue };
  }
  return out;
}

describe("play context", () => {
  it("starts at the chosen track and continues with the rest of the list", () => {
    const c = ctx("b");
    expect(contextCurrent(c)).toBe("b");
    expect(upcoming(c)).toEqual(["c", "d"]);
    expect(playOut(flow(c), "b")).toEqual(["b", "c", "d"]);
  });
  it("adds a start track that is not part of the list in front", () => {
    const c = openContext("搜索", ["a"], "x", false, low);
    expect(contextCurrent(c)).toBe("x");
    expect(upcoming(c)).toEqual(["a"]);
  });
  it("shuffles the other tracks and keeps the start first", () => {
    const c = ctx("b", true);
    expect(contextCurrent(c)).toBe("b");
    expect([...upcoming(c)].sort()).toEqual(["a", "c", "d"]);
    expect(upcoming(c)).not.toEqual(["a", "c", "d"]);
  });
  it("toggling shuffle keeps the current track and what was played", () => {
    let c = ctx("a");
    c = advance(flow(c), false, "a", low).context!; // now on b
    const on = withShuffle(c, true, low);
    expect(contextCurrent(on)).toBe("b");
    expect(on.order.slice(0, on.pos + 1)).toEqual(c.order.slice(0, c.pos + 1));
    expect([...upcoming(on)].sort()).toEqual(["c", "d"]);
    const off = withShuffle(on, false, low);
    expect(contextCurrent(off)).toBe("b");
    expect(upcoming(off)).toEqual(["c", "d"]);
  });
});

describe("user queue", () => {
  it("plays before the context continues and is consumed", () => {
    const f = flow(ctx("a"), ["x", "y"]);
    const one = advance(f, false, "a", low);
    expect(one).toMatchObject({ id: "x", fromQueue: true, queue: ["y"] });
    expect(one.context).toBe(f.context);
    expect(playOut(f, "a")).toEqual(["a", "x", "y", "b", "c", "d"]);
  });
  it("is not affected by shuffle or repeat", () => {
    const shuffled = flow(ctx("a", true), ["x", "y"], "context");
    expect(playOut(shuffled, "a", 2)).toEqual(["a", "x", "y"]);
    const one = flow(ctx("a"), ["x"], "one");
    // repeat-one replays on auto-advance, the queue waits
    expect(advance(one, true, "a", low)).toMatchObject({
      id: "a",
      fromQueue: false,
      queue: ["x"],
    });
    // a manual next still moves on, into the queue
    expect(advance(one, false, "a", low)).toMatchObject({
      id: "x",
      fromQueue: true,
    });
  });
});

describe("end of the context and repeat", () => {
  it("stops after the last track with repeat off", () => {
    let c = ctx("d");
    expect(advance(flow(c), true, "d", low).id).toBeNull();
    c = ctx("a");
    expect(playOut(flow(c), "a")).toEqual(["a", "b", "c", "d"]);
  });
  it("wraps to the first track under repeat context, reshuffling when shuffled", () => {
    const plain = advance(flow(ctx("d"), [], "context"), true, "d", low);
    expect(plain.id).toBe("a");
    // walk a shuffled context to its end, then repeat wraps with a fresh order
    let f = flow(ctx("a", true), [], "context");
    for (let i = 0; i < 3; i++)
      f = { ...f, context: advance(f, false, "-", low).context };
    const wrap = advance(f, true, "-", low);
    expect(wrap.context!.pos).toBe(0);
    expect(wrap.context!.order).toHaveLength(4);
    expect(new Set(wrap.context!.order).size).toBe(4);
  });
  it("repeat one replays the current track when it ends", () => {
    const step = advance(flow(ctx("b"), [], "one"), true, "b", low);
    expect(step.id).toBe("b");
    expect(step.context!.pos).toBe(ctx("b").pos);
  });
});

describe("previous", () => {
  it("restarts the track after 3 seconds", () => {
    expect(retreat(flow(ctx("c")), false, 3.5)).toEqual({ restart: true });
  });
  it("goes to the previous context track within 3 seconds", () => {
    const r = retreat(flow(ctx("c")), false, 2);
    expect(r).toMatchObject({ restart: false, id: "b" });
  });
  it("restarts at the first track unless repeating, which goes to the last", () => {
    expect(retreat(flow(ctx("a")), false, 1)).toEqual({ restart: true });
    expect(retreat(flow(ctx("a"), [], "context"), false, 1)).toMatchObject({
      id: "d",
    });
  });
  it("from a queued track returns to the context track played last", () => {
    expect(retreat(flow(ctx("c"), ["x"]), true, 1)).toMatchObject({ id: "c" });
  });
  it("restarts when there is no context", () => {
    expect(retreat(flow(null), false, 1)).toEqual({ restart: true });
  });
});

describe("editing the upcoming tracks", () => {
  it("reorders and removes only what is still to come", () => {
    const c = ctx("a");
    expect(upcoming(moveUpcoming(c, 0, 1))).toEqual(["c", "b", "d"]);
    expect(upcoming(moveUpcoming(c, 2, 1))).toEqual(["b", "c", "d"]);
    expect(upcoming(moveUpcoming(c, 0, -1))).toEqual(["b", "c", "d"]);
    const removed = removeUpcoming(c, 1);
    expect(upcoming(removed)).toEqual(["b", "d"]);
    expect(contextCurrent(removed)).toBe("a");
    expect(removeUpcoming(c, 9)).toBe(c);
  });
  it("jumping skips the tracks before the chosen one", () => {
    const c = jumpUpcoming(ctx("a"), 1);
    expect(contextCurrent(c)).toBe("c");
    expect(upcoming(c)).toEqual(["d"]);
  });
});
