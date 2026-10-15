/** Item sizes with prefix sums: O(log n) update, prefix and lookup; O(n) rebuild. */
export class SizeIndex {
  private values: number[] = [];
  private tree: number[] = [0];

  get length(): number {
    return this.values.length;
  }
  get total(): number {
    return this.prefix(this.values.length);
  }
  reset(values: readonly number[]): void {
    const n = values.length;
    const tree = new Array<number>(n + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      tree[i]! += values[i - 1]!;
      const parent = i + (i & -i);
      if (parent <= n) tree[parent]! += tree[i]!;
    }
    this.values = values.slice();
    this.tree = tree;
  }
  snapshot(): number[] {
    return this.values.slice();
  }
  size(index: number): number {
    return this.values[index]!;
  }
  set(index: number, value: number): void {
    const delta = value - this.values[index]!;
    if (!delta) return;
    this.values[index] = value;
    for (let i = index + 1; i < this.tree.length; i += i & -i)
      this.tree[i]! += delta;
  }
  /** Sum of the sizes before `end`. */
  prefix(end: number): number {
    let sum = 0;
    for (let i = end; i > 0; i -= i & -i) sum += this.tree[i]!;
    return sum;
  }
  /** Index of the item spanning `y` (clamped to the list); -1 when empty. */
  find(y: number): number {
    const n = this.values.length;
    if (!n) return -1;
    let index = 0;
    let sum = 0;
    let step = 1;
    while (step * 2 <= n) step *= 2;
    for (; step > 0; step = step >> 1) {
      const next = index + step;
      if (next <= n && sum + this.tree[next]! <= y) {
        index = next;
        sum += this.tree[next]!;
      }
    }
    return Math.min(index, n - 1);
  }
}
