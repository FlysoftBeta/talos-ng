import { AppError, Emitter } from "@talos/base";
import { storageError } from "../errors.ts";
import { isThenable, TxTask } from "./task.ts";
import { Table, TxTable } from "./table.ts";
import type { TransactionContext } from "./table.ts";

export interface Migration {
  version: number;
  /** `oldVersion` is the version the database is upgraded from (0 when created). */
  upgrade: (tx: IDBTransaction, oldVersion: number) => void;
}
export interface Change {
  tables: readonly string[];
  keys?: Readonly<Record<string, readonly IDBValidKey[]>>;
}
export interface ChangeChannel {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: unknown): void;
  close(): void;
}
export interface DbOptions {
  name: string;
  schema: readonly Migration[];
  onBlocked?: () => void;
  onVersionChange?: (version: number | null) => void;
  blockedTimeoutMs?: number;
  indexedDB?: IDBFactory;
  keyRange?: typeof IDBKeyRange;
  channel?: ((name: string) => ChangeChannel) | null;
  timers?: {
    set: (fn: () => void, ms: number) => unknown;
    clear: (id: unknown) => void;
  };
}
export class Transaction implements TransactionContext {
  readonly touched = new Set<string>();
  private active = true;
  constructor(
    private readonly native: IDBTransaction,
    readonly keyRange: typeof IDBKeyRange,
    readonly compare: (a: IDBValidKey, b: IDBValidKey) => number,
    private readonly fail: (error: unknown) => void,
  ) {}
  finish(): void {
    this.active = false;
  }
  private check(): void {
    if (!this.active) throw storageError({ name: "TransactionInactiveError" });
  }
  table<T, K extends IDBValidKey = IDBValidKey>(name: string): TxTable<T, K> {
    this.check();
    try {
      return new TxTable(this.native.objectStore(name), this);
    } catch (error) {
      const mapped = storageError(error);
      this.fail(mapped);
      throw mapped;
    }
  }
  touch(name: string): void {
    this.check();
    this.touched.add(name);
  }
  abort(): void {
    this.fail(new AppError("E_CANCELLED", "Transaction aborted"));
  }
  task<T>(
    start: (
      resolve: (value: T) => void,
      reject: (error: unknown) => void,
    ) => void,
  ): TxTask<T> {
    const task = new TxTask<T>(this.fail);
    try {
      this.check();
      start(
        (v) => task.resolve(v),
        (e) => {
          task.reject(e);
          this.fail(e);
        },
      );
    } catch (error) {
      task.reject(storageError(error));
      this.fail(error);
    }
    return task;
  }
  request<T>(make: () => IDBRequest<T>): TxTask<T> {
    return this.task((resolve, reject) => {
      const request = make();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
export class Database {
  private connection?: IDBDatabase;
  private opening?: Promise<IDBDatabase>;
  private closed = false;
  private invalidated = false;
  private readonly events = new Emitter<Change>();
  private readonly channel?: ChangeChannel;
  private readonly factory: IDBFactory;
  private readonly keyRange: typeof IDBKeyRange;
  constructor(private readonly options: DbOptions) {
    this.factory = options.indexedDB ?? indexedDB;
    this.keyRange = options.keyRange ?? IDBKeyRange;
    const makeChannel =
      options.channel === undefined
        ? typeof BroadcastChannel === "undefined"
          ? undefined
          : (name: string): ChangeChannel => new BroadcastChannel(name)
        : options.channel;
    this.channel = makeChannel?.(`talos-store:${options.name}`);
    if (this.channel)
      this.channel.onmessage = (event) => {
        const data = event.data as { tables?: unknown } | null;
        if (
          data &&
          Array.isArray(data.tables) &&
          data.tables.every((t) => typeof t === "string")
        )
          this.events.emit({ tables: data.tables as string[] });
      };
  }
  async connect(): Promise<IDBDatabase> {
    if (this.closed || this.invalidated)
      throw new AppError(
        this.invalidated ? "E_VERSION" : "E_CANCELLED",
        "Database handle closed",
      );
    if (this.connection) return this.connection;
    if (this.opening) return this.opening;
    this.opening = this.open();
    try {
      return await this.opening;
    } finally {
      this.opening = undefined;
    }
  }
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const timers = this.options.timers ?? {
        set: (fn: () => void, ms: number) => setTimeout(fn, ms),
        clear: (id: unknown) => clearTimeout(id as number),
      };
      let timer: unknown;
      let settled = false;
      let upgradeError: unknown;
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) timers.clear(timer);
        reject(storageError(error));
      };
      const request = this.factory.open(
        this.options.name,
        this.options.schema[this.options.schema.length - 1]!.version,
      );
      request.onblocked = () => {
        if (settled) return;
        timer = timers.set(
          () =>
            fail(
              new AppError(
                "E_BUSY",
                "Database upgrade blocked by another connection",
              ),
            ),
          this.options.blockedTimeoutMs ?? 5000,
        );
        try {
          this.options.onBlocked?.();
        } catch (error) {
          fail(error);
        }
      };
      request.onupgradeneeded = (event) => {
        if (settled || this.closed) {
          request.transaction!.abort();
          return;
        }
        try {
          for (const migration of this.options.schema)
            if (migration.version > event.oldVersion) {
              const result: unknown = migration.upgrade(
                request.transaction!,
                event.oldVersion,
              );
              if (isThenable(result)) {
                void Promise.resolve(result).catch(() => undefined);
                throw new AppError(
                  "E_INVALID",
                  "Migrations must be synchronous",
                );
              }
            }
        } catch (error) {
          upgradeError = error;
          request.transaction!.abort();
        }
      };
      request.onerror = () => fail(upgradeError ?? request.error);
      request.onsuccess = () => {
        const connection = request.result;
        if (settled || this.closed) {
          connection.close();
          fail(new AppError("E_CANCELLED", "Database closed while opening"));
          return;
        }
        settled = true;
        if (timer !== undefined) timers.clear(timer);
        this.connection = connection;
        connection.onversionchange = (event) => {
          connection.close();
          this.connection = undefined;
          this.invalidated = true;
          this.channel?.close();
          this.events.clear();
          this.options.onVersionChange?.(event.newVersion);
        };
        connection.onclose = () => {
          if (this.connection === connection) this.connection = undefined;
        };
        resolve(connection);
      };
    });
  }
  table<T, K extends IDBValidKey = IDBValidKey>(name: string): Table<T, K> {
    return new Table(this, name);
  }
  private recoverQuota?: () => Promise<void>;
  private quotaExhausted?: () => void;
  setQuotaRecovery(recover: () => Promise<void>, exhausted: () => void): void {
    this.recoverQuota = recover;
    this.quotaExhausted = exhausted;
  }
  async tx<T>(
    names: readonly string[],
    mode: IDBTransactionMode,
    body: (tx: Transaction) => T | TxTask<T>,
    retryQuota = true,
  ): Promise<T> {
    try {
      return await this.transact(names, mode, body);
    } catch (error) {
      const quota = (e: unknown): boolean =>
        e instanceof AppError &&
        !!(e.data as { quota?: boolean } | undefined)?.quota;
      if (
        !retryQuota ||
        mode !== "readwrite" ||
        !quota(error) ||
        !this.recoverQuota
      )
        throw error;
      try {
        await this.recoverQuota();
      } catch (recoveryError) {
        if (quota(recoveryError)) this.quotaExhausted?.();
        throw recoveryError;
      }
      try {
        return await this.transact(names, mode, body);
      } catch (retryError) {
        if (quota(retryError)) this.quotaExhausted?.();
        throw retryError;
      }
    }
  }
  private async transact<T>(
    names: readonly string[],
    mode: IDBTransactionMode,
    body: (tx: Transaction) => T | TxTask<T>,
  ): Promise<T> {
    const connection = await this.connect();
    return new Promise<T>((resolve, reject) => {
      let native: IDBTransaction;
      try {
        native = connection.transaction([...names], mode);
      } catch (error) {
        reject(storageError(error));
        return;
      }
      let failure: AppError | undefined;
      let value!: T;
      let ready = false;
      const fail = (error: unknown): void => {
        failure ??= storageError(error);
        try {
          native.abort();
        } catch {
          /* The completion handler still rejects a failed body. */
        }
      };
      const tx = new Transaction(
        native,
        this.keyRange,
        (a, b) => this.factory.cmp(a, b),
        fail,
      );
      native.onabort = () => {
        tx.finish();
        reject(failure ?? storageError(native.error ?? { name: "AbortError" }));
      };
      native.onerror = (event) => {
        failure ??= storageError(
          (event.target as IDBRequest<unknown>).error ?? native.error,
        );
      };
      native.oncomplete = () => {
        tx.finish();
        if (failure || !ready) {
          reject(
            failure ??
              new AppError(
                "E_INVALID",
                "TransactionInactiveError: unfinished transaction task",
              ),
          );
          return;
        }
        if (tx.touched.size) {
          const change = { tables: [...tx.touched] };
          this.events.emit(change);
          try {
            this.channel?.postMessage(change);
          } catch {
            /* Notifications are advisory; writes already committed. */
          }
        }
        resolve(value);
      };
      try {
        const result = body(tx);
        if (result instanceof TxTask)
          result.then((v) => {
            value = v;
            ready = true;
          }, fail);
        else if (isThenable(result)) {
          void Promise.resolve(result).catch(() => undefined);
          throw new AppError(
            "E_INVALID",
            "Transaction callbacks must not be async or return non-IDB promises",
          );
        } else {
          value = result;
          ready = true;
        }
      } catch (error) {
        fail(error);
      }
    });
  }
  subscribe(
    tables: readonly string[],
    fn: (change: Change) => void,
  ): () => void {
    return this.events.on((change) => {
      if (change.tables.some((t) => tables.includes(t))) fn(change);
    });
  }
  close(): void {
    this.closed = true;
    this.connection?.close();
    this.connection = undefined;
    this.channel?.close();
    this.events.clear();
  }
}
export async function openDb(options: DbOptions): Promise<Database> {
  if (
    !options.name ||
    !options.schema.length ||
    options.schema.some(
      (m, i) =>
        !Number.isSafeInteger(m.version) ||
        m.version < 1 ||
        (i > 0 && m.version <= options.schema[i - 1]!.version),
    )
  )
    throw new AppError(
      "E_INVALID",
      "Schema versions must be positive and strictly increasing",
    );
  const db = new Database(options);
  try {
    await db.connect();
    return db;
  } catch (error) {
    db.close();
    throw storageError(error);
  }
}
