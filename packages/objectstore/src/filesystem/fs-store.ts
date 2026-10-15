import { AppError, sleep } from "@talos/base";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isObjectId } from "../content/identity.ts";
import { chunks, hashStream } from "../content/stream.ts";
import {
  checkExpect,
  validateExpect,
  validateSize,
} from "../content/validation.ts";
import { errorCode } from "../errors.ts";
import { KeyLocks } from "../lifecycle/key-locks.ts";
import { Stages } from "../lifecycle/stages.ts";
import { createStore } from "../lifecycle/store.ts";
import type {
  ManagedObjectStore,
  ObjectInfo,
  ObjectStore,
  StoreOptions,
} from "../ports.ts";
import { isBusy, retryDelete } from "./deletion.ts";
import {
  entries,
  fileChunks,
  fileStat,
  openFile,
  removeFile,
  syncDirectory,
  writeBytes,
} from "./fs-io.ts";
import { objectPath } from "./path.ts";

export interface FsObjectStoreOptions extends StoreOptions {
  root: string;
  fsync?: boolean;
  /** Inject a scheduler for deterministic retry tests. */
  delay?: (ms: number) => Promise<void>;
}
export function createFsObjectStore(
  options: FsObjectStoreOptions,
): ManagedObjectStore {
  if (
    typeof options.root !== "string" ||
    !options.root ||
    options.root.includes("\0")
  )
    throw new AppError("E_INVALID", "Invalid object store root");
  const root = resolve(options.root),
    durable = options.fsync ?? true;
  const clock = options.clock ?? Date.now,
    delay = options.delay ?? sleep;
  const stageDir = join(root, "stages"),
    trashDir = join(root, "trash");
  const locks = new KeyLocks(),
    activePuts = new Set<string>();
  const stagePath = (id: string): string => join(stageDir, id);
  async function touch(path: string): Promise<void> {
    const now = clock();
    validateSize(now);
    await fs.utimes(path, now / 1000, now / 1000);
  }
  async function sync(path: string): Promise<void> {
    if (durable) await syncDirectory(path);
  }
  async function syncFile(path: string): Promise<void> {
    if (durable) {
      const handle = await fs.open(path, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
  }
  async function finishFile(path: string): Promise<void> {
    await touch(path);
    await syncFile(path);
  }
  async function publish(
    path: string,
    info: ObjectInfo,
    pending?: Set<string>,
  ): Promise<ObjectInfo> {
    return locks.run(info.id, async () => {
      const target = objectPath(root, info.id);
      await fs.mkdir(dirname(target), { recursive: true });
      let existing = await fileStat(target);
      // A crashed bulk write can leave an incomplete file. Only bulk replay repairs it.
      if (
        existing &&
        pending &&
        (await hashStream(fileChunks(target))).id !== info.id
      ) {
        await removeFile(target);
        existing = null;
      }
      if (existing) {
        if (existing.size !== info.size)
          throw new AppError(
            "E_INTEGRITY",
            "Existing object has a different size",
          );
        await removeFile(path);
      } else {
        // Source is closed (bulk sync is deferred); never overwrite a valid/open object.
        await fs.rename(path, target);
        if (!pending) await sync(dirname(target));
      }
      if (pending) pending.add(target);
      else {
        // A concurrent batch may have published this object but not flushed it yet.
        if (existing) {
          await syncFile(target);
          for (let dir = dirname(target); ; dir = dirname(dir)) {
            await sync(dir);
            if (dir === root) break;
          }
        }
        await sync(stageDir);
      }
      return info;
    });
  }
  const stages = new Stages({
    async ensure(id) {
      await fs.mkdir(stageDir, { recursive: true });
      const path = stagePath(id);
      const existing = await fileStat(path);
      if (existing) return existing.size;
      const handle = await fs.open(path, "wx");
      try {
        await touch(path);
        if (durable) await handle.sync();
      } finally {
        await handle.close();
      }
      await sync(stageDir);
      return 0;
    },
    async size(id) {
      const stat = await fileStat(stagePath(id));
      if (!stat) throw new AppError("E_NOT_FOUND", "Stage not found");
      return stat.size;
    },
    async append(id, chunk, offset) {
      const path = stagePath(id),
        handle = await fs.open(path, "r+");
      try {
        await writeBytes(handle, chunk, offset);
        await touch(path);
        if (durable) await handle.sync();
        return offset + chunk.byteLength;
      } finally {
        await handle.close();
      }
    },
    async commit(id, expect) {
      const path = stagePath(id);
      const info = await hashStream(fileChunks(path));
      checkExpect(info, expect);
      await finishFile(path);
      return publish(path, info);
    },
    remove: (id) => removeFile(stagePath(id)),
  });
  async function put(
    src: Parameters<ObjectStore["put"]>[0],
    expect?: Partial<ObjectInfo>,
    pending?: Set<string>,
  ): Promise<ObjectInfo> {
    validateExpect(expect);
    await fs.mkdir(stageDir, { recursive: true });
    const name = `.put-${randomUUID()}`,
      path = stagePath(name);
    activePuts.add(name);
    try {
      const handle = await fs.open(path, "wx");
      let info: ObjectInfo;
      try {
        const hash = createHash("sha256");
        let size = 0;
        for await (const chunk of chunks(src)) {
          validateSize(size + chunk.byteLength);
          await writeBytes(handle, chunk, size);
          hash.update(chunk);
          size += chunk.byteLength;
        }
        info = { id: hash.digest("hex"), size };
        checkExpect(info, expect);
        await touch(path);
        if (durable && !pending) await handle.sync();
      } finally {
        await handle.close();
      }
      return await publish(path, info, pending);
    } finally {
      activePuts.delete(name);
      await removeFile(path);
    }
  }
  return createStore({
    put,
    beginBulk() {
      const pending = new Set<string>();
      let closed = false;
      let writing = false;
      return {
        async put(src, expect) {
          if (closed || writing)
            throw new AppError(
              "E_CONFLICT",
              "Bulk puts must be awaited before commit",
            );
          writing = true;
          try {
            return await put(src, expect, pending);
          } finally {
            writing = false;
          }
        },
        async commit() {
          if (closed || writing)
            throw new AppError("E_CONFLICT", "Bulk batch is closed or writing");
          closed = true;
          if (!durable || !pending.size) return;
          // Queue a bounded sync pass so the filesystem can coalesce disk flushes.
          await syncPass([...pending], syncFile);
          let directories = new Set([...pending].map(dirname));
          directories.add(stageDir);
          // Persist new shard directory entries from leaves to root (Linux).
          // Windows still flushes every file above; Node has no directory fsync there.
          while (directories.size) {
            await syncPass([...directories], sync);
            directories = new Set(
              [...directories].filter((p) => p !== root).map(dirname),
            );
          }
          await sync(dirname(root));
        },
      };
    },
    stage: (id) => stages.open(id),
    async stat(id) {
      const stat = await fileStat(objectPath(root, id));
      return stat
        ? { id, size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) }
        : null;
    },
    open: (id) => openFile(objectPath(root, id)),
    localPath: (id) => objectPath(root, id),
    delete: (id) =>
      locks.run(id, async () => {
        const path = objectPath(root, id);
        const result = await retryDelete(() => fs.unlink(path), delay);
        if (result !== "busy") return result === "deleted";
        await fs.mkdir(trashDir, { recursive: true });
        try {
          await fs.rename(path, join(trashDir, `${id}-${randomUUID()}`));
        } catch (error) {
          if (errorCode(error) === "ENOENT") return false;
          throw error;
        }
        return true;
      }),
    async *list() {
      for await (const a of entries(join(root, "objects"))) {
        if (!a.isDirectory() || !/^[0-9a-f]{2}$/.test(a.name)) continue;
        for await (const b of entries(join(root, "objects", a.name))) {
          if (!b.isDirectory() || !/^[0-9a-f]{2}$/.test(b.name)) continue;
          for await (const file of entries(
            join(root, "objects", a.name, b.name),
          )) {
            const id = file.name;
            if (
              !file.isFile() ||
              !isObjectId(id) ||
              !id.startsWith(a.name + b.name)
            )
              continue;
            const stat = await fileStat(objectPath(root, id));
            if (stat)
              yield { id, size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) };
          }
        }
      }
    },
    async sweepStages(age) {
      const cutoff = clock() - age;
      let removed = 0;
      for await (const entry of entries(stageDir)) {
        if (
          !entry.isFile() ||
          !/^(?:[A-Za-z0-9_-]{1,64}|\.put-[0-9a-f-]{36})$/.test(entry.name)
        )
          continue;
        await stages.locks.run(entry.name, async () => {
          if (activePuts.has(entry.name)) return;
          const path = stagePath(entry.name),
            stat = await fileStat(path);
          if (!stat || stat.mtimeMs >= cutoff) return;
          try {
            await fs.unlink(path);
          } catch (error) {
            if (errorCode(error) === "ENOENT" || isBusy(error)) return;
            throw error;
          }
          stages.invalidate(entry.name);
          removed++;
        });
      }
      return removed;
    },
    async sweepTrash() {
      let removed = 0;
      for await (const entry of entries(trashDir)) {
        if (!entry.isFile() || !/^[0-9a-f]{64}-[0-9a-f-]{36}$/.test(entry.name))
          continue;
        if (
          (await retryDelete(
            () => fs.unlink(join(trashDir, entry.name)),
            delay,
          )) === "deleted"
        )
          removed++;
      }
      return removed;
    },
  });
}

async function syncPass(
  paths: string[],
  sync: (path: string) => Promise<void>,
): Promise<void> {
  let next = 0;
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(32, paths.length) }, async () => {
      while (next < paths.length) await sync(paths[next++]!);
    }),
  );
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
}
