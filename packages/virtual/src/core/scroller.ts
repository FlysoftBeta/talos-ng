import { AppError } from "@talos/base";
import type {
  Align,
  Direction,
  Entry,
  Place,
  Request,
  Seek,
  Source,
  SourceEvent,
} from "./protocol.ts";
import { SizeIndex } from "./sizes.ts";

/** A seek plus how the found item is placed in the viewport. */
export type Target<L = never> = Seek<L> & {
  readonly align?: Align;
  /** Px from the aligned viewport edge: start/end inset, center shift. */
  readonly offset?: number;
};
export type JumpResult = "done" | "missing" | "failed" | "superseded";

export interface ScrollerOptions {
  /** Size in px of an item without a hint or a measurement. Default 48. */
  estimate?: number;
  /** Px rendered beyond each viewport edge. Default 320. */
  overscan?: number;
  /** Px beyond the viewport within which a loaded end asks the source for more.
   * Default: the larger of twice the overscan and one viewport. */
  prefetch?: number;
  /** Once scrolled to the very end, keep the end in view while items grow or arrive. */
  stickToEnd?: boolean;
  /** Px from an end that still counts as being at it. Default 4. */
  endThreshold?: number;
  /** Most items kept loaded; the side far from the viewport is released beyond it. */
  maxItems?: number;
  /** Measured sizes remembered for ids that left the window. Default 2000. */
  cache?: number;
}

export interface EdgeView {
  readonly more: boolean;
  readonly state: "idle" | "loading" | "failed";
  readonly error: unknown;
}
export type ScrollerStatus = "idle" | "seeking" | "ready" | "failed";
/** What to render. Changes identity only when rendering must change. */
export interface ScrollerView<T> {
  readonly version: number;
  readonly status: ScrollerStatus;
  /** Why the last seek failed. */
  readonly error: unknown;
  /** The rendered entries: the viewport plus overscan, in order. */
  readonly items: readonly Entry<T>[];
  /** Loaded entries, rendered or not. */
  readonly count: number;
  readonly before: EdgeView;
  readonly after: EdgeView;
  readonly atStart: boolean;
  readonly atEnd: boolean;
}
/** Where things go, in content px. Changes on every scroll and measurement. */
export interface Geometry {
  readonly top: number;
  readonly height: number;
  readonly viewport: number;
  /** Top of the first rendered entry. */
  readonly itemsTop: number;
  /** Top of the trailing edge slot. */
  readonly afterTop: number;
}
/** Facts observed in the view, applied in one step. */
export interface Reading {
  readonly viewport?: number;
  /** A width change invalidates remembered sizes of items not rendered. */
  readonly width?: number;
  /** The user (not the scroller) moved the scroll offset by this many px. */
  readonly scrolledBy?: number;
  readonly sizes?: Iterable<readonly [string, number]>;
  /** Size of the leading and trailing edge slots. */
  readonly before?: number;
  readonly after?: number;
}
export interface VisibleEntry<T> {
  readonly id: string;
  readonly item: T;
  /** Px relative to the viewport top. */
  readonly top: number;
  readonly bottom: number;
}

type Anchor =
  | { readonly kind: "none" }
  /** The first item in the viewport: its top stays `offset` px below the viewport top. */
  | { readonly kind: "item"; readonly id: string; readonly offset: number }
  /**
   * Following the end of a fully loaded list, `gap` px above it: the gap the user left
   * stays while scrolling; once the content changes the view returns to the very end.
   */
  | { readonly kind: "end"; readonly gap: number; readonly height: number }
  /** Programmatic placements, kept while sizes settle until the user takes over. */
  | { readonly kind: "edge"; readonly edge: "start" | "end" }
  | {
      readonly kind: "align";
      readonly id: string;
      readonly align: Align;
      readonly offset: number;
    };
interface Edge {
  readonly more: boolean;
  readonly state: EdgeView["state"];
  readonly error: unknown;
  readonly token: number;
  readonly from: string | undefined;
}
interface Pending<L> {
  readonly token: number;
  readonly target: Target<L>;
  /** Internal reloads land as a plain anchor, not a sticky placement. */
  readonly reload: boolean;
  readonly resolve: (result: JumpResult) => void;
}

const NONE: Anchor = { kind: "none" };
const noop = (): void => undefined;
const edge = (more: boolean): Edge => ({
  more,
  state: "idle",
  error: undefined,
  token: 0,
  from: undefined,
});
function unique<T>(items: readonly Entry<T>[]): Entry<T>[] {
  const seen = new Set<string>();
  return items.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}
const valid = (size: unknown): size is number =>
  typeof size === "number" && Number.isFinite(size) && size >= 0;

/**
 * Id-based virtual scrolling state machine, free of any DOM.
 *
 * Holds a contiguous window of the source's list, the size of every loaded item (measured
 * or estimated) and an anchor: normally the first item in the viewport, whose distance to
 * the viewport top survives every size change, insert and removal. Growth above it pushes
 * content up (the scroll offset follows), growth below it pushes content down.
 * Every input (view readings, commands, source events) runs as one queued step; listeners
 * are told once per step.
 */
export class Scroller<T, L = never> {
  private readonly estimate: number;
  private readonly overscan: number;
  private readonly reach: number | undefined;
  private readonly stick: boolean;
  private readonly threshold: number;
  private readonly maxItems: number;
  private readonly cacheLimit: number;

  private entries: Entry<T>[] = [];
  private positions = new Map<string, number>();
  private readonly sizes = new SizeIndex();
  private readonly cache = new Map<string, number>();
  private lead = 0;
  private trail = 0;
  private viewport = 0;
  private width = -1;
  private top = 0;
  private anchor: Anchor = NONE;
  private status: ScrollerStatus = "idle";
  private error: unknown = undefined;
  private edges: Record<Direction, Edge> = {
    before: edge(false),
    after: edge(false),
  };
  private pending: Pending<L> | undefined;
  private failedTarget: Target<L> | undefined;
  /** The source invalidated the window while a seek was pending: only a seek reply can fix it. */
  private stale = false;
  private tokens = 0;
  private first = 0;
  private last = 0;
  private atStart = true;
  private atEnd = true;
  private version = 1;
  private view: ScrollerView<T>;
  private shape: Geometry;
  private disconnect: (() => void) | undefined;
  private depth = 0;
  private readonly queue: Array<() => void> = [];
  private readonly viewListeners = new Set<() => void>();
  private readonly geometryListeners = new Set<() => void>();

  constructor(
    private readonly source: Source<T, L>,
    options: ScrollerOptions = {},
  ) {
    this.estimate = Math.max(1, options.estimate ?? 48);
    this.overscan = Math.max(0, options.overscan ?? 320);
    this.reach = options.prefetch;
    this.stick = options.stickToEnd ?? false;
    this.threshold = Math.max(0, options.endThreshold ?? 4);
    this.maxItems = Math.max(1, options.maxItems ?? Infinity);
    this.cacheLimit = Math.max(0, options.cache ?? 2000);
    this.view = this.buildView();
    this.shape = this.buildGeometry();
  }

  // ---- outputs ----

  /** For `useSyncExternalStore`: render state changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  };
  getSnapshot = (): ScrollerView<T> => this.view;
  /** Geometry changes (every scroll, measurement and render change). */
  observe(listener: () => void): () => void {
    this.geometryListeners.add(listener);
    return () => this.geometryListeners.delete(listener);
  }
  geometry(): Geometry {
    return this.shape;
  }
  has(id: string): boolean {
    return this.positions.has(id);
  }
  /** Content px of a loaded item's top. */
  offsetOf(id: string): number | undefined {
    const index = this.positions.get(id);
    return index === undefined
      ? undefined
      : this.lead + this.sizes.prefix(index);
  }
  /** Loaded ids in order. */
  ids(): string[] {
    return this.entries.map((entry) => entry.id);
  }
  /** Loaded entries intersecting the viewport, with px relative to its top. */
  visible(): VisibleEntry<T>[] {
    const result: VisibleEntry<T>[] = [];
    const n = this.entries.length;
    if (!n) return result;
    const to = this.top + this.viewport;
    for (let i = this.indexAt(this.top); i < n; i++) {
      const y = this.lead + this.sizes.prefix(i);
      if (y >= to) break;
      const size = this.sizes.size(i);
      if (y + size <= this.top) continue;
      const entry = this.entries[i]!;
      result.push({
        id: entry.id,
        item: entry.item,
        top: y - this.top,
        bottom: y + size - this.top,
      });
    }
    return result;
  }
  /** A start or jump placement still holds the view (until the user scrolls or `release()`). */
  placing(): boolean {
    return this.anchor.kind === "edge" || this.anchor.kind === "align";
  }
  /** The first item in the viewport and its top relative to the viewport top. */
  position(): { id: string; offset: number } | undefined {
    const anchor = this.derive(this.top);
    return anchor.kind === "item"
      ? { id: anchor.id, offset: anchor.offset }
      : undefined;
  }

  // ---- commands ----

  /** Connects the source and seeks the initial position. */
  start(target: Target<L>): Promise<JumpResult> {
    if (!this.disconnect)
      this.disconnect = this.source.connect((event) =>
        this.run(() => this.apply(event)),
      );
    return this.jump(target);
  }
  dispose(): void {
    this.disconnect?.();
    this.disconnect = undefined;
    const pending = this.pending;
    this.pending = undefined;
    pending?.resolve("superseded");
  }
  /** Shows the target: in place when it is loaded, otherwise through a seek. */
  jump(target: Target<L>): Promise<JumpResult> {
    return new Promise((resolve) =>
      this.run(() => {
        const local = this.stale ? undefined : this.local(target);
        if (local) {
          this.cancelSeek();
          if (this.status === "failed") {
            this.status = "ready";
            this.error = undefined;
          }
          this.anchor = local;
          this.touch();
          this.settle();
          resolve("done");
        } else {
          this.seek(target, resolve, false);
          this.settle();
        }
      }),
    );
  }
  /** Applies view facts: viewport, user scrolling, item and edge slot sizes. */
  sense(reading: Reading): void {
    this.run(() => {
      if (reading.width !== undefined && reading.width !== this.width) {
        if (this.width >= 0) this.cache.clear();
        this.width = reading.width;
      }
      if (valid(reading.viewport) && reading.viewport !== this.viewport) {
        this.viewport = reading.viewport;
        this.touch();
      }
      if (reading.scrolledBy) this.scrolled(this.top + reading.scrolledBy);
      if (reading.sizes)
        for (const [id, size] of reading.sizes) {
          const index = this.positions.get(id);
          if (index === undefined || !valid(size)) continue;
          this.remember(id, size);
          if (Math.abs(this.sizes.size(index) - size) > 0.01)
            this.sizes.set(index, size);
        }
      if (valid(reading.before)) this.lead = reading.before;
      if (valid(reading.after)) this.trail = reading.after;
      this.settle();
    });
  }
  /** Scrolls as the user would (ending any placement). */
  scrollBy(delta: number): void {
    this.sense({ scrolledBy: delta });
  }
  /** Ends a programmatic placement: from now on the first visible item is the anchor. */
  release(): void {
    this.run(() => {
      this.pin();
      this.settle();
    });
  }
  /** Re-arms failed ends and repeats a failed seek. */
  retry(): void {
    this.run(() => {
      if (this.status === "failed" && this.failedTarget)
        this.seek(this.failedTarget, noop, false);
      for (const direction of ["before", "after"] as const) {
        const current = this.edges[direction];
        if (current.state === "failed")
          this.setEdge(direction, edge(current.more));
      }
      this.settle();
    });
  }

  // ---- step machinery ----

  private run(step: () => void): void {
    this.queue.push(step);
    if (this.depth) return;
    this.depth++;
    try {
      while (this.queue.length) this.queue.shift()!();
    } finally {
      this.depth--;
    }
    this.publish();
  }
  private touch(): void {
    this.version++;
  }
  private publish(): void {
    if (this.view.version !== this.version) {
      this.view = this.buildView();
      this.viewListeners.forEach((listener) => listener());
    }
    const next = this.buildGeometry();
    const last = this.shape;
    if (
      next.top !== last.top ||
      next.height !== last.height ||
      next.viewport !== last.viewport ||
      next.itemsTop !== last.itemsTop ||
      next.afterTop !== last.afterTop
    ) {
      this.shape = next;
      this.geometryListeners.forEach((listener) => listener());
    }
  }
  private buildView(): ScrollerView<T> {
    const view = (value: Edge): EdgeView => ({
      more: value.more,
      state: value.state,
      error: value.error,
    });
    return {
      version: this.version,
      status: this.status,
      error: this.error,
      items: this.entries.slice(this.first, this.last),
      count: this.entries.length,
      before: view(this.edges.before),
      after: view(this.edges.after),
      atStart: this.atStart,
      atEnd: this.atEnd,
    };
  }
  private buildGeometry(): Geometry {
    return {
      top: this.top,
      height: this.lead + this.sizes.total + this.trail,
      viewport: this.viewport,
      itemsTop: this.lead + this.sizes.prefix(this.first),
      afterTop: this.lead + this.sizes.total,
    };
  }

  // ---- source events ----

  private apply(event: SourceEvent<T>): void {
    switch (event.type) {
      case "seeked":
        return this.seeked(event);
      case "extended":
        return this.extended(event.token, event.items, event.more);
      case "failed":
        return this.failed(event.token, event.error);
      case "insert":
        return this.insert(event.place, event.items);
      case "update":
        this.update(event.items);
        return this.settle();
      case "remove":
        return this.remove(event.ids);
      case "more":
        return this.more(event.direction, event.more);
      case "invalidate":
        return this.invalidate();
    }
  }
  private seeked(event: Extract<SourceEvent<T>, { type: "seeked" }>): void {
    const pending = this.pending;
    if (!pending || pending.token !== event.token) return;
    this.pending = undefined;
    this.stale = false;
    const kept = this.derive(this.top);
    this.replace(event.items);
    this.edges = { before: edge(event.before), after: edge(event.after) };
    this.status = "ready";
    this.error = undefined;
    this.failedTarget = undefined;
    const target = pending.target;
    let result: JumpResult = "done";
    if (!this.entries.length) this.anchor = NONE;
    else if ("edge" in target)
      this.anchor =
        target.edge === "end" && this.stick && !event.after
          ? this.end(0)
          : { kind: "edge", edge: target.edge };
    else {
      const id = event.focus ?? ("id" in target ? target.id : undefined);
      if (id !== undefined && this.positions.has(id))
        this.anchor = pending.reload
          ? { kind: "item", id, offset: target.offset ?? 0 }
          : {
              kind: "align",
              id,
              align: target.align ?? "start",
              offset: target.offset ?? 0,
            };
      else {
        result = "missing";
        this.anchor =
          kept.kind === "item" && this.positions.has(kept.id)
            ? kept
            : { kind: "edge", edge: "start" };
      }
    }
    this.touch();
    this.settle();
    pending.resolve(result);
  }
  private extended(
    token: number,
    items: readonly Entry<T>[],
    more: boolean,
  ): void {
    const direction = (["before", "after"] as const).find(
      (side) =>
        this.edges[side].state === "loading" &&
        this.edges[side].token === token,
    );
    if (!direction) return;
    const fresh = unique(items).filter(
      (entry) => !this.positions.has(entry.id),
    );
    const n = this.entries.length;
    const boundary =
      direction === "before" ? this.entries[0]?.id : this.entries[n - 1]?.id;
    const progressed =
      fresh.length > 0 || boundary !== this.edges[direction].from;
    if (fresh.length) {
      const a = this.anchor;
      if (
        a.kind === "edge" &&
        (a.edge === "start") === (direction === "before")
      )
        this.pin();
      this.insertAt(direction === "before" ? 0 : n, fresh);
    }
    // A reply that adds nothing yet claims more would ask again forever.
    this.setEdge(
      direction,
      !progressed && more
        ? {
            ...edge(true),
            state: "failed",
            error: new AppError(
              "E_PROTOCOL",
              "Source returned no items while claiming more",
            ),
          }
        : edge(more),
    );
    this.settle();
  }
  private failed(token: number, error: unknown): void {
    const pending = this.pending;
    if (pending && pending.token === token) {
      this.pending = undefined;
      this.status = "failed";
      this.error = error;
      this.failedTarget = pending.target;
      this.touch();
      this.settle();
      pending.resolve("failed");
      return;
    }
    for (const direction of ["before", "after"] as const) {
      const current = this.edges[direction];
      if (current.state === "loading" && current.token === token)
        this.setEdge(direction, {
          ...edge(current.more),
          state: "failed",
          error,
        });
    }
    this.settle();
  }
  private insert(place: Place, items: readonly Entry<T>[]): void {
    const list = unique(items);
    this.update(list.filter((entry) => this.positions.has(entry.id)));
    const fresh = list.filter((entry) => !this.positions.has(entry.id));
    let at: number | undefined;
    if (place === "start") at = this.edges.before.more ? undefined : 0;
    else if (place === "end")
      at = this.edges.after.more ? undefined : this.entries.length;
    else if ("after" in place) {
      const index = this.positions.get(place.after);
      at = index === undefined ? undefined : index + 1;
    } else at = this.positions.get(place.before);
    if (fresh.length && at !== undefined) this.insertAt(at, fresh);
    this.settle();
  }
  private update(items: readonly Entry<T>[]): void {
    for (const entry of items) {
      const index = this.positions.get(entry.id);
      if (index === undefined) continue;
      this.entries[index] = entry;
      if (valid(entry.size)) {
        this.cache.delete(entry.id);
        this.sizes.set(index, entry.size);
      }
      this.touch();
    }
  }
  private remove(ids: readonly string[]): void {
    const doomed = new Set(ids.filter((id) => this.positions.has(id)));
    if (!doomed.size) return;
    const a = this.anchor;
    if ((a.kind === "item" || a.kind === "align") && doomed.has(a.id)) {
      // The next surviving item takes the removed anchor's place; the content above stays.
      const index = this.positions.get(a.id)!;
      const offset = this.lead + this.sizes.prefix(index) - this.top;
      this.anchor = NONE;
      for (let i = index + 1; i < this.entries.length; i++)
        if (!doomed.has(this.entries[i]!.id)) {
          this.anchor = { kind: "item", id: this.entries[i]!.id, offset };
          break;
        }
      if (this.anchor === NONE)
        for (let i = index - 1; i >= 0; i--)
          if (!doomed.has(this.entries[i]!.id)) {
            this.anchor = {
              kind: "item",
              id: this.entries[i]!.id,
              offset: offset - this.sizes.size(i),
            };
            break;
          }
    }
    const sizes = this.sizes.snapshot();
    const kept: Entry<T>[] = [];
    const keptSizes: number[] = [];
    this.entries.forEach((entry, i) => {
      if (doomed.has(entry.id)) this.cache.delete(entry.id);
      else {
        kept.push(entry);
        keptSizes.push(sizes[i]!);
      }
    });
    this.rebuild(kept, keptSizes);
    if (
      !kept.length &&
      this.status !== "seeking" &&
      (this.edges.before.more || this.edges.after.more)
    )
      this.seek({ edge: this.stick ? "end" : "start" }, noop, true);
    this.settle();
  }
  private more(direction: Direction, more: boolean): void {
    const current = this.edges[direction];
    if (current.state === "loading") {
      if (current.more !== more) this.setEdge(direction, { ...current, more });
    } else if (current.more !== more || current.state !== "idle")
      this.setEdge(direction, edge(more));
    this.settle();
  }
  private invalidate(): void {
    if (this.status === "idle") return;
    if (this.pending) {
      // The pending reply may predate the change: ask again so the answer comes after it.
      this.stale = true;
      this.seek(
        this.pending.target,
        this.pending.resolve,
        this.pending.reload,
        true,
      );
      return this.settle();
    }
    this.stale = true;
    const a = this.anchor;
    const position = this.derive(this.top);
    const target: Target<L> =
      a.kind === "end" || (a.kind === "edge" && a.edge === "end")
        ? { edge: "end" }
        : a.kind === "edge"
          ? { edge: "start" }
          : a.kind === "align"
            ? { id: a.id, align: a.align, offset: a.offset }
            : position.kind === "item"
              ? { id: position.id, offset: position.offset }
              : { edge: this.stick ? "end" : "start" };
    this.seek(target, noop, a.kind !== "align");
    this.settle();
  }

  // ---- window edits ----

  private seek(
    target: Target<L>,
    resolve: (result: JumpResult) => void,
    reload: boolean,
    repeat = false,
  ): void {
    const token = ++this.tokens;
    if (!repeat) this.cancelSeek();
    this.pending = { token, target, reload, resolve };
    this.status = "seeking";
    this.error = undefined;
    for (const direction of ["before", "after"] as const)
      if (this.edges[direction].state === "loading")
        this.setEdge(direction, { ...edge(this.edges[direction].more) });
    this.touch();
    const seek: Seek<L> =
      "edge" in target
        ? { edge: target.edge }
        : "id" in target
          ? { id: target.id }
          : { key: target.key };
    this.request({ kind: "seek", token, seek });
  }
  private cancelSeek(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    this.status = this.entries.length ? "ready" : "idle";
    this.touch();
    pending.resolve("superseded");
  }
  private request(request: Request<L>): void {
    try {
      this.source.request(request);
    } catch (error) {
      this.run(() => this.failed(request.token, error));
    }
  }
  private local(target: Target<L>): Anchor | undefined {
    if ("edge" in target) {
      if (
        !this.entries.length ||
        this.edges[target.edge === "start" ? "before" : "after"].more
      )
        return undefined;
      return target.edge === "end" && this.stick
        ? this.end(0)
        : { kind: "edge", edge: target.edge };
    }
    if ("id" in target && this.positions.has(target.id))
      return {
        kind: "align",
        id: target.id,
        align: target.align ?? "start",
        offset: target.offset ?? 0,
      };
    return undefined;
  }
  private replace(items: readonly Entry<T>[]): void {
    const list = unique(items);
    this.rebuild(
      list,
      list.map((entry) => this.cache.get(entry.id) ?? this.hint(entry)),
    );
  }
  private insertAt(at: number, items: readonly Entry<T>[]): void {
    const sizes = this.sizes.snapshot();
    sizes.splice(
      at,
      0,
      ...items.map((entry) => this.cache.get(entry.id) ?? this.hint(entry)),
    );
    const entries = this.entries.slice();
    entries.splice(at, 0, ...items);
    this.rebuild(entries, sizes);
  }
  private rebuild(entries: Entry<T>[], sizes: number[]): void {
    this.entries = entries;
    this.positions = new Map(entries.map((entry, i) => [entry.id, i]));
    this.sizes.reset(sizes);
    this.touch();
  }
  private hint(entry: Entry<T>): number {
    return valid(entry.size) ? entry.size : this.estimate;
  }
  private remember(id: string, size: number): void {
    this.cache.delete(id);
    this.cache.set(id, size);
    if (this.cache.size > this.cacheLimit)
      for (const key of this.cache.keys()) {
        if (this.cache.size <= this.cacheLimit || this.positions.has(key))
          break;
        this.cache.delete(key);
      }
  }
  private setEdge(direction: Direction, value: Edge): void {
    this.edges = { ...this.edges, [direction]: value };
    this.touch();
  }

  // ---- layout ----

  private maxTop(): number {
    return Math.max(
      0,
      this.lead + this.sizes.total + this.trail - this.viewport,
    );
  }
  private indexAt(y: number): number {
    return y <= this.lead ? 0 : this.sizes.find(y - this.lead);
  }
  private derive(y: number): Anchor {
    if (!this.entries.length) return NONE;
    const index = this.indexAt(y);
    return {
      kind: "item",
      id: this.entries[index]!.id,
      offset: this.lead + this.sizes.prefix(index) - y,
    };
  }
  private following(y: number): boolean {
    return (
      this.stick &&
      !this.edges.after.more &&
      this.entries.length > 0 &&
      y >= this.maxTop() - this.threshold
    );
  }
  private end(gap: number): Anchor {
    return {
      kind: "end",
      gap,
      height: this.lead + this.sizes.total + this.trail,
    };
  }
  /** The plain anchor for a position: following the end, or the first visible item. */
  private plain(y: number): Anchor {
    return this.following(y) ? this.end(this.maxTop() - y) : this.derive(y);
  }
  /** Turns a programmatic placement into the plain anchor at the current position. */
  private pin(): void {
    if (this.anchor.kind === "edge" || this.anchor.kind === "align")
      this.anchor = this.plain(this.top);
  }
  private scrolled(y: number): void {
    this.top = Math.max(0, Math.min(y, this.maxTop()));
    this.anchor = this.plain(this.top);
  }
  /** Places the anchor, clamps, picks the rendered range and asks for what is missing. */
  private settle(): void {
    const n = this.entries.length;
    const max = this.maxTop();
    let a = this.anchor;
    if (
      a.kind === "end" &&
      a.height !== this.lead + this.sizes.total + this.trail
    )
      this.anchor = a = this.end(0);
    let desired = this.top;
    if (a.kind === "end") desired = max - a.gap;
    else if (a.kind === "edge" && a.edge === "end") desired = max;
    else if (a.kind === "edge") desired = 0;
    else if (a.kind === "item" || a.kind === "align") {
      const index = this.positions.get(a.id);
      if (index !== undefined) {
        const y = this.lead + this.sizes.prefix(index);
        const size = this.sizes.size(index);
        desired =
          a.kind === "item" || a.align === "start"
            ? y - a.offset
            : a.align === "end"
              ? y + size - this.viewport + a.offset
              : y + (size - this.viewport) / 2 + a.offset;
      }
    }
    this.top = Math.max(0, Math.min(desired, max));
    // A clamped anchor is kept, not re-derived: content measured later may make room again.
    const clamped = Math.abs(desired - this.top) > 1e-6;
    if (!n || a.kind === "none") this.anchor = this.derive(this.top);
    else if (a.kind === "item") {
      if (!this.positions.has(a.id)) this.anchor = this.derive(this.top);
      else if (!clamped)
        this.anchor = this.following(this.top)
          ? this.end(max - this.top)
          : this.derive(this.top);
    } else if (a.kind === "align" && !this.positions.has(a.id))
      this.anchor = this.derive(this.top);

    let start = 0;
    let end = 0;
    if (n) {
      const from = this.top - this.overscan;
      const to = this.top + this.viewport + this.overscan;
      start = this.indexAt(from);
      end = to <= this.lead ? 0 : this.sizes.find(to - this.lead) + 1;
      if (end < start) end = start;
    }
    if (start !== this.first || end !== this.last) {
      this.first = start;
      this.last = end;
      this.touch();
    }
    const atStart = !this.edges.before.more && this.top <= this.threshold;
    const atEnd = !this.edges.after.more && this.top >= max - this.threshold;
    if (atStart !== this.atStart || atEnd !== this.atEnd) {
      this.atStart = atStart;
      this.atEnd = atEnd;
      this.touch();
    }
    if (n > this.maxItems && this.trim(n - this.maxItems)) return this.settle();
    this.prefetch();
  }
  /**
   * Releases items on the side farther from the viewport, only beyond the prefetch reach:
   * releasing anything nearer would be asked for again at once.
   */
  private trim(excess: number): boolean {
    const n = this.entries.length;
    const reach = this.distance();
    const to = this.top + this.viewport + reach;
    const before = this.indexAt(this.top - reach);
    const after =
      n - (to <= this.lead ? 0 : this.sizes.find(to - this.lead) + 1);
    const direction: Direction = after >= before ? "after" : "before";
    const count = Math.min(excess, direction === "after" ? after : before);
    if (count <= 0) return false;
    const sizes = this.sizes.snapshot();
    if (direction === "after")
      this.rebuild(this.entries.slice(0, n - count), sizes.slice(0, n - count));
    else this.rebuild(this.entries.slice(count), sizes.slice(count));
    this.setEdge(direction, edge(true));
    return true;
  }
  /** Px beyond the viewport that should be loaded. */
  private distance(): number {
    return Math.max(
      this.overscan,
      this.reach ?? Math.max(this.overscan * 2, this.viewport),
    );
  }
  private prefetch(): void {
    if (this.status !== "ready" && this.status !== "failed") return;
    const n = this.entries.length;
    if (!n || this.viewport <= 0) return;
    const reach = this.distance();
    const total = this.sizes.total;
    if (this.wants("before") && this.top - reach < this.lead)
      this.extend("before", this.entries[0]!.id);
    if (
      this.wants("after") &&
      this.top + this.viewport + reach > this.lead + total
    )
      this.extend("after", this.entries[n - 1]!.id);
  }
  private wants(direction: Direction): boolean {
    const current = this.edges[direction];
    return current.more && current.state === "idle";
  }
  private extend(direction: Direction, from: string): void {
    const token = ++this.tokens;
    this.setEdge(direction, {
      more: true,
      state: "loading",
      error: undefined,
      token,
      from,
    });
    this.request({ kind: "extend", token, direction, from });
  }
}
