import { ShellError, shellError } from "./error.ts";
import type {
  BuildRecord,
  ShellEnvironment,
  ShellManifest,
  ShellStatus,
  StoredAsset,
} from "./types.ts";

/** Shell has no store dependency: only plain records, arrays and byte buffers persist. */
function put(
  store: IDBObjectStore,
  value: unknown,
  key: IDBValidKey,
): IDBRequest<IDBValidKey> {
  const pending = [value];
  const seen = new Set<object>();
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === "function" || typeof item === "symbol")
      throw new ShellError("E_INVALID", "资源必须是普通数据");
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    if (item instanceof ArrayBuffer) continue;
    const tag = Object.prototype.toString.call(item);
    if (tag !== "[object Object]" && tag !== "[object Array]")
      throw new ShellError("E_INVALID", "禁止持久化 Blob 或非普通数据");
    for (const name of Object.keys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, name)!;
      if (descriptor.get || descriptor.set)
        throw new ShellError("E_INVALID", "禁止持久化访问器");
      pending.push(descriptor.value);
    }
  }
  return store.put(value, key);
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(shellError(value.error));
  });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(shellError(transaction.error));
    transaction.onerror = () => {
      /* onabort reports the transaction failure. */
    };
  });
}
const metaKeys = [
  "active",
  "pending",
  "previous",
  "bootAttempts",
  "activation",
] as const;
type Metadata = {
  active: string | null;
  pending: string | null;
  previous: string | null;
  bootAttempts: number;
  activation: string | null;
};
async function metadata(store: IDBObjectStore): Promise<Metadata> {
  const values: unknown[] = await Promise.all(
    metaKeys.map((key) => request(store.get(key))),
  );
  return {
    active: typeof values[0] === "string" ? values[0] : null,
    pending: typeof values[1] === "string" ? values[1] : null,
    previous: typeof values[2] === "string" ? values[2] : null,
    bootAttempts: typeof values[3] === "number" ? values[3] : 0,
    activation: typeof values[4] === "string" ? values[4] : null,
  };
}
function putMetadata(store: IDBObjectStore, values: Metadata): void {
  metaKeys.forEach((key) => put(store, values[key], key));
}

/** Connections are instance-owned and explicitly closable. All state changes are atomic. */
export class ShellDatabase {
  private connection: Promise<IDBDatabase> | undefined;
  constructor(private readonly environment: ShellEnvironment = {}) {}
  private open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    const factory = this.environment.indexedDB ?? indexedDB;
    this.connection = new Promise((resolve, reject) => {
      const opening = factory.open(
        this.environment.databaseName ?? "talos-shell",
        1,
      );
      let blocked = false;
      opening.onupgradeneeded = () => {
        const db = opening.result;
        if (!db.objectStoreNames.contains("assets"))
          db.createObjectStore("assets");
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        if (!db.objectStoreNames.contains("builds"))
          db.createObjectStore("builds");
      };
      opening.onsuccess = () => {
        if (blocked) {
          opening.result.close();
          return;
        }
        opening.result.onversionchange = () => {
          opening.result.close();
          this.connection = undefined;
        };
        resolve(opening.result);
      };
      opening.onerror = () => {
        this.connection = undefined;
        reject(shellError(opening.error));
      };
      opening.onblocked = () => {
        blocked = true;
        this.connection = undefined;
        reject(new ShellError("E_BUSY", "请关闭其他页面后重试"));
      };
    });
    return this.connection;
  }
  async close(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    if (connection) (await connection).close();
  }
  private async transaction<T>(
    stores: string[],
    mode: IDBTransactionMode,
    operation: (transaction: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const db = await this.open();
    const transaction = db.transaction(stores, mode);
    const done = completed(transaction);
    try {
      const result = await operation(transaction);
      await done;
      return result;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* Already completed/aborted. */
      }
      await done.catch(() => undefined);
      throw shellError(error);
    }
  }
  async status(): Promise<ShellStatus> {
    return this.transaction(["meta", "builds"], "readonly", async (tx) => {
      const [meta, builds] = await Promise.all([
        metadata(tx.objectStore("meta")),
        request<BuildRecord[]>(tx.objectStore("builds").getAll()),
      ]);
      return {
        active: meta.active,
        pending: meta.pending,
        previous: meta.previous,
        bootAttempts: meta.bootAttempts,
        builds,
      };
    });
  }
  async getAsset(
    build: string,
    path: string,
  ): Promise<StoredAsset | undefined> {
    return this.transaction(["assets"], "readonly", async (tx) =>
      request<StoredAsset | undefined>(
        tx.objectStore("assets").get([build, path]),
      ),
    );
  }
  async putAsset(
    build: string,
    path: string,
    asset: StoredAsset,
  ): Promise<void> {
    await this.transaction(["assets", "builds"], "readwrite", async (tx) => {
      const record = await request<BuildRecord | undefined>(
        tx.objectStore("builds").get(build),
      );
      if (!record) throw new ShellError("E_CONFLICT", "下载期间版本记录已删除");
      await request(put(tx.objectStore("assets"), asset, [build, path]));
    });
  }
  async beginBuild(manifest: ShellManifest): Promise<void> {
    await this.transaction(["builds"], "readwrite", async (tx) => {
      const store = tx.objectStore("builds");
      const existing = await request<BuildRecord | undefined>(
        store.get(manifest.build),
      );
      if (
        existing &&
        JSON.stringify(existing.manifest) !== JSON.stringify(manifest)
      )
        throw new ShellError("E_CONFLICT", "版本标识已被其他资源使用");
      if (!existing)
        await request(
          put(store, { manifest, complete: false }, manifest.build),
        );
    });
  }
  async completeBuild(manifest: ShellManifest): Promise<void> {
    await this.transaction(
      ["builds", "meta", "assets"],
      "readwrite",
      async (tx) => {
        const store = tx.objectStore("meta");
        const meta = await metadata(store);
        const record = await request<BuildRecord | undefined>(
          tx.objectStore("builds").get(manifest.build),
        );
        if (
          !record ||
          JSON.stringify(record.manifest) !== JSON.stringify(manifest)
        )
          throw new ShellError("E_CONFLICT", "下载期间版本记录已更改");
        const assets = await Promise.all(
          manifest.assets.map((asset) =>
            request<StoredAsset | undefined>(
              tx.objectStore("assets").get([manifest.build, asset.path]),
            ),
          ),
        );
        if (
          assets.some(
            (asset, index) =>
              !asset ||
              asset.bytes.byteLength !== manifest.assets[index]!.size ||
              asset.sha256 !== manifest.assets[index]!.sha256,
          )
        )
          throw new ShellError("E_INTEGRITY", "资源尚未完整写入");
        put(
          tx.objectStore("builds"),
          { manifest, complete: true },
          manifest.build,
        );
        if (!meta.active) {
          meta.active = manifest.build;
          meta.bootAttempts = 0;
        } else if (meta.active !== manifest.build)
          meta.pending = manifest.build;
        putMetadata(store, meta);
      },
    );
  }
  async activate(build?: string): Promise<void> {
    await this.transaction(["builds", "meta"], "readwrite", async (tx) => {
      const store = tx.objectStore("meta");
      const meta = await metadata(store);
      const selected = build ?? meta.pending;
      if (!selected) throw new ShellError("E_NOT_FOUND", "没有已就绪的新版本");
      const record = await request<BuildRecord | undefined>(
        tx.objectStore("builds").get(selected),
      );
      if (!record?.complete)
        throw new ShellError("E_NOT_FOUND", "版本尚未下载完成");
      meta.activation = selected !== meta.active ? selected : null;
      putMetadata(store, meta);
    });
  }
  /** Third navigation rolls back after the first two boots were not confirmed. */
  async navigate(): Promise<string | null> {
    return this.transaction(["meta", "builds"], "readwrite", async (tx) => {
      const store = tx.objectStore("meta");
      const meta = await metadata(store);
      if (meta.activation && meta.activation !== meta.active) {
        const record = await request<BuildRecord | undefined>(
          tx.objectStore("builds").get(meta.activation),
        );
        if (record?.complete) {
          meta.previous = meta.previous ?? meta.active;
          meta.active = meta.activation;
          meta.bootAttempts = 0;
        }
        if (meta.pending === meta.activation) meta.pending = null;
        meta.activation = null;
      }
      if (meta.previous && meta.bootAttempts >= 2) {
        meta.active = meta.previous;
        meta.previous = null;
        meta.bootAttempts = 0;
      } else if (meta.previous) meta.bootAttempts += 1;
      putMetadata(store, meta);
      return meta.active;
    });
  }
  async confirmBoot(build: string): Promise<void> {
    await this.transaction(["meta"], "readwrite", async (tx) => {
      const store = tx.objectStore("meta");
      const meta = await metadata(store);
      if (meta.active !== build)
        throw new ShellError("E_CONFLICT", "启动确认不属于当前版本");
      meta.previous = null;
      meta.bootAttempts = 0;
      putMetadata(store, meta);
    });
  }
  async prune(): Promise<readonly string[]> {
    return this.transaction(
      ["meta", "builds", "assets"],
      "readwrite",
      async (tx) => {
        const [meta, builds] = await Promise.all([
          metadata(tx.objectStore("meta")),
          request<BuildRecord[]>(tx.objectStore("builds").getAll()),
        ]);
        const keep = new Set([
          meta.active,
          meta.pending,
          meta.previous,
          meta.activation,
        ]);
        const removed: string[] = [];
        builds.forEach((record) => {
          const build = record.manifest.build;
          if (keep.has(build)) return;
          removed.push(build);
          record.manifest.assets.forEach((asset) =>
            tx.objectStore("assets").delete([build, asset.path]),
          );
          tx.objectStore("builds").delete(build);
        });
        return removed;
      },
    );
  }
}
