import type {
  Direction,
  Entry,
  Place,
  Request,
  Seek,
  Source,
  SourceEvent,
} from "../core/protocol.ts";

export interface ArraySourceOptions<T, L = never> {
  key(item: T): string;
  /** Size hint in px for an item that has not been measured. */
  size?(item: T): number | undefined;
  /** Whether an item kept its rendering; default `Object.is`. */
  equals?(a: T, b: T): boolean;
  /** Items per reply; default all. */
  page?: number;
  /** Resolves a source-defined seek key to an id. */
  locate?(key: L, items: readonly T[]): string | undefined;
  /**
   * The list is exhausted on that side but `remote` says more exists elsewhere: fetch it,
   * call `set()` with the grown list, then resolve.
   */
  load?(direction: Direction): Promise<unknown>;
  /** Runs before a seek is answered; may fetch and `set()` what the seek needs. */
  prepare?(seek: Seek<L>, items: readonly T[]): Promise<unknown> | undefined;
}
/** Whether items exist beyond the local list, reachable through `load`. */
export interface Remote {
  readonly before?: boolean;
  readonly after?: boolean;
}

/**
 * A source over an in-memory ordered list owned by the caller. `set()` replaces the list
 * and emits the difference as positional inserts, removals and updates; an order change
 * among kept items, or a list sharing nothing with the previous one, emits `invalidate`.
 */
export class ArraySource<T, L = never> implements Source<T, L> {
  private items: readonly T[] = [];
  private ids: string[] = [];
  private positions = new Map<string, number>();
  private remote = { before: false, after: false };
  private emit: ((event: SourceEvent<T>) => void) | undefined;
  private connection = 0;
  private readonly page: number;

  constructor(
    private readonly options: ArraySourceOptions<T, L>,
    items: readonly T[] = [],
    remote: Remote = {},
  ) {
    this.page = Math.max(1, options.page ?? Infinity);
    this.adopt(items, remote);
  }
  get list(): readonly T[] {
    return this.items;
  }
  connect(emit: (event: SourceEvent<T>) => void): () => void {
    const connection = ++this.connection;
    this.emit = emit;
    return () => {
      if (this.connection !== connection) return;
      this.connection++;
      this.emit = undefined;
    };
  }
  set(items: readonly T[], remote?: Remote): void {
    const previous = {
      ids: this.ids,
      items: this.items,
      positions: this.positions,
      remote: this.remote,
    };
    this.adopt(items, remote ?? previous.remote);
    const emit = this.emit;
    if (!emit) return;
    for (const direction of ["before", "after"] as const)
      // Only "more" is safe to announce: the scroller's window may end before the list does.
      if (this.remote[direction] && !previous.remote[direction])
        emit({ type: "more", direction, more: true });
    let last = -1;
    let common = 0;
    for (const id of this.ids) {
      const position = previous.positions.get(id);
      if (position === undefined) continue;
      common++;
      if (position < last) return emit({ type: "invalidate" });
      last = position;
    }
    if (!common) {
      if (previous.ids.length || this.ids.length) emit({ type: "invalidate" });
      return;
    }
    const removed = previous.ids.filter((id) => !this.positions.has(id));
    if (removed.length) emit({ type: "remove", ids: removed });
    for (let i = 0; i < this.ids.length;) {
      if (previous.positions.has(this.ids[i]!)) {
        i++;
        continue;
      }
      let j = i;
      while (j < this.ids.length && !previous.positions.has(this.ids[j]!)) j++;
      const place: Place =
        i > 0
          ? { after: this.ids[i - 1]! }
          : j < this.ids.length
            ? { before: this.ids[j]! }
            : "start";
      emit({ type: "insert", place, items: this.entries(i, j) });
      i = j;
    }
    const equals = this.options.equals ?? Object.is;
    const changed: Entry<T>[] = [];
    this.ids.forEach((id, i) => {
      const position = previous.positions.get(id);
      if (
        position !== undefined &&
        !equals(previous.items[position]!, this.items[i]!)
      )
        changed.push(this.entry(i));
    });
    if (changed.length) emit({ type: "update", items: changed });
  }
  request(request: Request<L>): void {
    const connection = this.connection;
    const emit = (event: SourceEvent<T>): void => {
      if (connection === this.connection) this.emit?.(event);
    };
    if (request.kind === "seek")
      void this.seek(request.token, request.seek, emit);
    else void this.extend(request.token, request.direction, request.from, emit);
  }

  private adopt(items: readonly T[], remote: Remote): void {
    const ids = items.map((item) => this.options.key(item));
    const positions = new Map<string, number>();
    ids.forEach((id, i) => {
      if (positions.has(id)) throw new Error(`Duplicate list key ${id}`);
      positions.set(id, i);
    });
    this.items = items;
    this.ids = ids;
    this.positions = positions;
    this.remote = { before: !!remote.before, after: !!remote.after };
  }
  private entry(i: number): Entry<T> {
    const item = this.items[i]!;
    const size = this.options.size?.(item);
    return size === undefined
      ? { id: this.ids[i]!, item }
      : { id: this.ids[i]!, item, size };
  }
  private entries(from: number, to: number): Entry<T>[] {
    const result: Entry<T>[] = [];
    for (let i = from; i < to; i++) result.push(this.entry(i));
    return result;
  }
  private async seek(
    token: number,
    seek: Seek<L>,
    emit: (event: SourceEvent<T>) => void,
  ): Promise<void> {
    try {
      const prepared = this.options.prepare?.(seek, this.items);
      if (prepared) await prepared;
      const n = this.ids.length;
      let focus: string | undefined;
      let from = 0;
      let to = Math.min(n, this.page);
      if ("edge" in seek) {
        if (seek.edge === "end") {
          to = n;
          from = Math.max(0, n - this.page);
        }
      } else {
        focus =
          "id" in seek ? seek.id : this.options.locate?.(seek.key, this.items);
        const index =
          focus === undefined ? undefined : this.positions.get(focus);
        if (index === undefined) focus = undefined;
        else {
          from = Math.max(0, index - Math.floor(this.page / 2));
          to = Math.min(n, from + this.page);
          from = Math.max(0, to - this.page);
        }
      }
      emit({
        type: "seeked",
        token,
        items: this.entries(from, to),
        before: n > 0 && (from > 0 || this.remote.before),
        after: n > 0 && (to < n || this.remote.after),
        ...(focus === undefined ? {} : { focus }),
      });
    } catch (error) {
      emit({ type: "failed", token, error });
    }
  }
  private async extend(
    token: number,
    direction: Direction,
    from: string,
    emit: (event: SourceEvent<T>) => void,
  ): Promise<void> {
    try {
      let reply = this.slice(direction, from);
      if (reply && !reply.items.length && reply.more && this.options.load) {
        await this.options.load(direction);
        reply = this.slice(direction, from);
      }
      emit(
        reply
          ? { type: "extended", token, items: reply.items, more: reply.more }
          : { type: "invalidate" },
      );
    } catch (error) {
      emit({ type: "failed", token, error });
    }
  }
  private slice(
    direction: Direction,
    from: string,
  ): { items: Entry<T>[]; more: boolean } | undefined {
    const index = this.positions.get(from);
    if (index === undefined) return undefined;
    if (direction === "before") {
      const start = Math.max(0, index - this.page);
      return {
        items: this.entries(start, index),
        more: start > 0 || this.remote.before,
      };
    }
    const end = Math.min(this.ids.length, index + 1 + this.page);
    return {
      items: this.entries(index + 1, end),
      more: end < this.ids.length || this.remote.after,
    };
  }
}
