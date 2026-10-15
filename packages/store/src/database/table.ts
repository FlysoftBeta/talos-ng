import { AppError } from "@talos/base";
import { guardValue } from "./guard.ts";
import type { TxTask } from "./task.ts";
import type { Database } from "./database.ts";

export interface Range<K extends IDBValidKey = IDBValidKey> {
  lower?: K;
  upper?: K;
  lowerOpen?: boolean;
  upperOpen?: boolean;
  reverse?: boolean;
  limit?: number;
}
export interface TransactionContext {
  request<T>(make: () => IDBRequest<T>): TxTask<T>;
  task<T>(
    start: (
      resolve: (value: T) => void,
      reject: (error: unknown) => void,
    ) => void,
  ): TxTask<T>;
  touch(table: string): void;
  keyRange: typeof IDBKeyRange;
  compare(a: IDBValidKey, b: IDBValidKey): number;
}
function bounds<K extends IDBValidKey>(
  factory: typeof IDBKeyRange,
  range: Range<K>,
): IDBKeyRange | undefined {
  if (range.lower !== undefined && range.upper !== undefined)
    return factory.bound(
      range.lower,
      range.upper,
      range.lowerOpen,
      range.upperOpen,
    );
  if (range.lower !== undefined)
    return factory.lowerBound(range.lower, range.lowerOpen);
  if (range.upper !== undefined)
    return factory.upperBound(range.upper, range.upperOpen);
  return undefined;
}
function empty<K extends IDBValidKey>(
  context: TransactionContext,
  range: Range<K>,
): boolean {
  return (
    range.lower !== undefined &&
    range.upper !== undefined &&
    context.compare(range.lower, range.upper) === 0 &&
    Boolean(range.lowerOpen || range.upperOpen)
  );
}
export class TxQuery<T, K extends IDBValidKey = IDBValidKey> {
  constructor(
    protected readonly source: IDBObjectStore | IDBIndex,
    protected readonly context: TransactionContext,
  ) {}
  get(key: K): TxTask<T | undefined> {
    return this.context.request<T | undefined>(() => this.source.get(key));
  }
  getMany(keys: readonly K[]): TxTask<(T | undefined)[]> {
    return this.context.task((resolve) => {
      const values: (T | undefined)[] = new Array(keys.length);
      let remaining = keys.length;
      if (!remaining) resolve(values);
      keys.forEach((key, i) => {
        this.get(key).then((value) => {
          values[i] = value;
          if (!--remaining) resolve(values);
        });
      });
    });
  }
  count(range: Range<K> = {}): TxTask<number> {
    return this.context.task((resolve) => {
      if (empty(this.context, range)) resolve(0);
      else
        this.context
          .request(() =>
            this.source.count(bounds(this.context.keyRange, range)),
          )
          .then(resolve);
    });
  }
  range(range: Range<K> = {}): TxTask<T[]> {
    return this.context.task((resolve) => {
      const limit = range.limit ?? Infinity;
      if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 0))
        throw new AppError(
          "E_INVALID",
          "Range limit must be a nonnegative integer",
        );
      const result: T[] = [];
      if (limit === 0 || empty(this.context, range)) {
        resolve(result);
        return;
      }
      const request = this.source.openCursor(
        bounds(this.context.keyRange, range),
        range.reverse ? "prev" : "next",
      );
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(result);
          return;
        }
        result.push(cursor.value as T);
        if (result.length >= limit) resolve(result);
        else cursor.continue();
      };
    });
  }
}
export class TxTable<T, K extends IDBValidKey = IDBValidKey> extends TxQuery<
  T,
  K
> {
  constructor(
    private readonly store: IDBObjectStore,
    context: TransactionContext,
  ) {
    super(store, context);
  }
  put(value: T, key?: K): TxTask<K> {
    return this.context.task((resolve, reject) => {
      guardValue(value);
      this.context.touch(this.store.name);
      this.context
        .request<IDBValidKey>(() =>
          key === undefined
            ? this.store.put(value)
            : this.store.put(value, key),
        )
        .then((v) => resolve(v as K), reject);
    });
  }
  putMany(values: readonly T[]): TxTask<K[]> {
    return this.context.task((resolve) => {
      const result: K[] = new Array(values.length);
      let remaining = values.length;
      if (!remaining) resolve(result);
      values.forEach((value, i) => {
        this.put(value).then((key) => {
          result[i] = key;
          if (!--remaining) resolve(result);
        });
      });
    });
  }
  delete(key: K): TxTask<void> {
    this.context.touch(this.store.name);
    return this.context.request(() => this.store.delete(key));
  }
  deleteRange(range: Range<K>): TxTask<void> {
    this.context.touch(this.store.name);
    return this.context.task((resolve) => {
      if (empty(this.context, range)) resolve(undefined);
      else
        this.context
          .request(() => {
            const key = bounds(this.context.keyRange, range);
            return key ? this.store.delete(key) : this.store.clear();
          })
          .then(resolve);
    });
  }
  clear(): TxTask<void> {
    this.context.touch(this.store.name);
    return this.context.request(() => this.store.clear());
  }
  byIndex<I extends IDBValidKey = IDBValidKey>(name: string): TxQuery<T, I> {
    return new TxQuery(this.store.index(name), this.context);
  }
}
export class Query<T, K extends IDBValidKey = IDBValidKey> {
  constructor(
    protected readonly db: Database,
    protected readonly name: string,
    private readonly index?: string,
  ) {}
  protected read<R>(fn: (table: TxQuery<T, K>) => TxTask<R>): Promise<R> {
    return this.db.tx([this.name], "readonly", (tx) => {
      const table = tx.table<T, K>(this.name);
      return fn(this.index ? table.byIndex<K>(this.index) : table);
    });
  }
  get(key: K): Promise<T | undefined> {
    return this.read((t) => t.get(key));
  }
  getMany(keys: readonly K[]): Promise<(T | undefined)[]> {
    return this.read((t) => t.getMany(keys));
  }
  count(range: Range<K> = {}): Promise<number> {
    return this.read((t) => t.count(range));
  }
  range(range: Range<K> = {}): Promise<T[]> {
    return this.read((t) => t.range(range));
  }
}
export class Table<T, K extends IDBValidKey = IDBValidKey> extends Query<T, K> {
  private write<R>(fn: (table: TxTable<T, K>) => TxTask<R>): Promise<R> {
    return this.db.tx([this.name], "readwrite", (tx) =>
      fn(tx.table<T, K>(this.name)),
    );
  }
  put(value: T, key?: K): Promise<K> {
    return this.write((t) => t.put(value, key));
  }
  putMany(values: readonly T[]): Promise<K[]> {
    return this.write((t) => t.putMany(values));
  }
  delete(key: K): Promise<void> {
    return this.write((t) => t.delete(key));
  }
  deleteRange(range: Range<K>): Promise<void> {
    return this.write((t) => t.deleteRange(range));
  }
  clear(): Promise<void> {
    return this.write((t) => t.clear());
  }
  byIndex<I extends IDBValidKey = IDBValidKey>(name: string): Query<T, I> {
    return new Query(this.db, this.name, name);
  }
}
