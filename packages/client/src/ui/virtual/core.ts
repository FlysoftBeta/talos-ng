import { AppError } from "@talos/base";

export type VirtualKey = string | number;
export type Alignment = "start" | "center" | "end" | "auto";
export interface VirtualRange {
  start: number;
  end: number;
  top: number;
  total: number;
}
export interface VirtualListOptions {
  estimatedItemHeight?: number;
  overscan?: number;
  stickToBottom?: boolean;
}

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new AppError("E_INVALID", `${name}必须为正数`);
}
function nonnegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0)
    throw new AppError("E_INVALID", `${name}必须为非负数`);
}

/** DOM-free height index. Scroll/measure queries are O(log n); replacing keys is O(n). */
export class VirtualListCore<K extends VirtualKey = VirtualKey> {
  private keys: readonly K[] = [];
  private indices = new Map<K, number>();
  private heights: number[] = [];
  private tree: number[] = [0];
  private measured = new Map<K, number>();
  private scrollOffset = 0;
  private viewportHeight = 0;
  private readonly estimate: number;
  private readonly overscan: number;
  private readonly stick: boolean;

  constructor(options: VirtualListOptions = {}) {
    this.estimate = options.estimatedItemHeight ?? 44;
    this.overscan = options.overscan ?? 240;
    this.stick = options.stickToBottom ?? false;
    positive(this.estimate, "预估高度");
    nonnegative(this.overscan, "预渲染距离");
  }
  get offset(): number {
    return this.scrollOffset;
  }
  get totalSize(): number {
    return this.prefix(this.keys.length);
  }
  get count(): number {
    return this.keys.length;
  }

  setItems(keys: readonly K[]): number {
    const indices = new Map<K, number>();
    keys.forEach((key, index) => {
      if (
        (typeof key === "number" && !Number.isFinite(key)) ||
        indices.has(key)
      ) {
        throw new AppError("E_INVALID", "列表键必须唯一且有效");
      }
      indices.set(key, index);
    });
    const pinned = this.atBottom();
    const oldIndex = this.indexAt(this.scrollOffset);
    const anchor = this.keys[oldIndex];
    const within = this.scrollOffset - this.prefix(oldIndex);
    this.keys = keys.slice();
    this.indices = indices;
    this.heights = keys.map((key) => this.measured.get(key) ?? this.estimate);
    for (const key of this.measured.keys())
      if (!indices.has(key)) this.measured.delete(key);
    this.tree = new Array<number>(keys.length + 1).fill(0);
    for (let i = 1; i <= keys.length; i++) {
      this.tree[i] = (this.tree[i] ?? 0) + (this.heights[i - 1] ?? 0);
      const parent = i + (i & -i);
      if (parent <= keys.length)
        this.tree[parent] = (this.tree[parent] ?? 0) + (this.tree[i] ?? 0);
    }
    const next = anchor === undefined ? undefined : indices.get(anchor);
    this.scrollOffset = this.clamp(
      pinned
        ? this.maximum()
        : next === undefined
          ? this.scrollOffset
          : this.prefix(next) + within,
    );
    return this.scrollOffset;
  }

  setViewport(offset: number, height: number): number {
    nonnegative(offset, "滚动位置");
    nonnegative(height, "视口高度");
    const pinned = this.atBottom();
    const resized = height !== this.viewportHeight;
    this.viewportHeight = height;
    this.scrollOffset = this.clamp(
      pinned && resized && offset === this.scrollOffset
        ? this.maximum()
        : offset,
    );
    return this.scrollOffset;
  }

  measure(index: number, height: number): number {
    this.assertIndex(index);
    positive(height, "行高度");
    const pinned = this.atBottom();
    const anchor = this.indexAt(this.scrollOffset);
    const delta = height - (this.heights[index] ?? this.estimate);
    this.heights[index] = height;
    this.measured.set(this.keys[index]!, height);
    for (let i = index + 1; i < this.tree.length; i += i & -i)
      this.tree[i] = (this.tree[i] ?? 0) + delta;
    this.scrollOffset = this.clamp(
      pinned
        ? this.maximum()
        : this.scrollOffset + (index < anchor ? delta : 0),
    );
    return this.scrollOffset;
  }

  offsetOf(index: number): number {
    this.assertIndex(index);
    return this.prefix(index);
  }

  sizeOf(index: number): number {
    this.assertIndex(index);
    return this.heights[index]!;
  }

  scrollToIndex(index: number, alignment: Alignment = "auto"): number {
    this.assertIndex(index);
    const top = this.prefix(index);
    const height = this.heights[index] ?? this.estimate;
    let offset = top;
    if (alignment === "center") offset -= (this.viewportHeight - height) / 2;
    else if (alignment === "end") offset -= this.viewportHeight - height;
    else if (alignment === "auto") {
      if (
        top >= this.scrollOffset &&
        top + height <= this.scrollOffset + this.viewportHeight
      )
        return this.scrollOffset;
      if (top > this.scrollOffset && height < this.viewportHeight)
        offset -= this.viewportHeight - height;
    }
    this.scrollOffset = this.clamp(offset);
    return this.scrollOffset;
  }

  scrollToKey(key: K, alignment: Alignment = "auto"): number {
    const index = this.indices.get(key);
    if (index === undefined)
      throw new AppError("E_NOT_FOUND", "列表项目不存在");
    return this.scrollToIndex(index, alignment);
  }

  range(overscan = this.overscan): VirtualRange {
    nonnegative(overscan, "预渲染距离");
    if (!this.count) return { start: 0, end: 0, top: 0, total: 0 };
    const start = this.indexAt(Math.max(0, this.scrollOffset - overscan));
    const edge = Math.min(
      this.totalSize,
      this.scrollOffset + this.viewportHeight + overscan,
    );
    const edgeIndex = this.indexAt(edge);
    const end = Math.min(
      this.count,
      edgeIndex + (this.prefix(edgeIndex) < edge ? 1 : 0),
    );
    return {
      start,
      end: Math.max(start, end),
      top: this.prefix(start),
      total: this.totalSize,
    };
  }

  private assertIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.count)
      throw new AppError("E_INVALID", "列表索引超出范围");
  }
  private maximum(): number {
    return Math.max(0, this.totalSize - this.viewportHeight);
  }
  private clamp(offset: number): number {
    return Math.max(0, Math.min(offset, this.maximum()));
  }
  private atBottom(): boolean {
    return this.stick && this.maximum() - this.scrollOffset <= 1;
  }
  private prefix(end: number): number {
    let sum = 0;
    for (let i = end; i > 0; i -= i & -i) sum += this.tree[i] ?? 0;
    return sum;
  }
  private indexAt(offset: number): number {
    let index = 0;
    let sum = 0;
    let step = 1;
    while (step * 2 <= this.count) step *= 2;
    for (; step > 0; step = Math.floor(step / 2)) {
      const next = index + step;
      const value = this.tree[next] ?? 0;
      if (next <= this.count && sum + value <= offset) {
        index = next;
        sum += value;
      }
    }
    return Math.min(index, Math.max(0, this.count - 1));
  }
}
