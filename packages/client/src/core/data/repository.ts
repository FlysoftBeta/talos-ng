import { Emitter } from "@talos/base";
import type { Database } from "@talos/store";
import type { StoredRow } from "./db.ts";
/** Stable immutable snapshots, hydrated on commit; never performs network reads. */
export class Repository<T> {
  private value: readonly T[] = [];
  private rows: readonly StoredRow[] = [];
  private readonly events = new Emitter<void>();
  constructor(
    private readonly select: (rows: readonly StoredRow[]) => readonly T[],
  ) {}
  getSnapshot = (): readonly T[] => this.value;
  subscribe = (fn: () => void): (() => void) => this.events.on(fn);
  hydrate(rows: readonly StoredRow[]): void {
    this.rows = rows;
    this.value = this.select(rows);
    this.events.emit();
  }
  async put(db: Database, row: StoredRow): Promise<void> {
    await db.table<StoredRow>("rows").put(row);
    this.hydrate([
      ...this.rows.filter(
        (held) =>
          held.scope !== row.scope ||
          held.type !== row.type ||
          held.id !== row.id,
      ),
      row,
    ]);
  }
}
