import { AppError, concat } from "@talos/base";
import { chunks, hashStream } from "../content/stream.ts";
import { checkExpect, validateSize } from "../content/validation.ts";
import { Stages } from "../lifecycle/stages.ts";
import { createStore } from "../lifecycle/store.ts";
import type { ManagedObjectStore, ObjectInfo, StoreOptions } from "../ports.ts";

interface MemoryFile {
  bytes: Uint8Array;
  mtimeMs: number;
}
export function createMemoryObjectStore(
  options: StoreOptions = {},
): ManagedObjectStore {
  const clock = options.clock ?? Date.now;
  const objects = new Map<string, MemoryFile>(),
    pending = new Map<string, MemoryFile>();
  const now = (): number => {
    const value = clock();
    validateSize(value);
    return value;
  };
  function requireFile(map: Map<string, MemoryFile>, id: string): MemoryFile {
    const file = map.get(id);
    if (!file) throw new AppError("E_NOT_FOUND", "Object or stage not found");
    return file;
  }
  async function publish(
    bytes: Uint8Array,
    expect?: Partial<ObjectInfo>,
  ): Promise<ObjectInfo> {
    const info = await hashStream(bytes);
    checkExpect(info, expect);
    if (!objects.has(info.id)) objects.set(info.id, { bytes, mtimeMs: now() });
    return info;
  }
  const stages = new Stages({
    async ensure(id) {
      if (!pending.has(id))
        pending.set(id, { bytes: new Uint8Array(), mtimeMs: now() });
      return requireFile(pending, id).bytes.length;
    },
    async size(id) {
      return requireFile(pending, id).bytes.length;
    },
    async append(id, chunk) {
      const file = requireFile(pending, id);
      file.bytes = concat(file.bytes, chunk);
      file.mtimeMs = now();
      return file.bytes.length;
    },
    async commit(id, expect) {
      const info = await publish(requireFile(pending, id).bytes, expect);
      pending.delete(id);
      return info;
    },
    async remove(id) {
      pending.delete(id);
    },
  });
  return createStore({
    async put(src, expect) {
      const parts: Uint8Array[] = [];
      for await (const part of chunks(src)) parts.push(new Uint8Array(part));
      return publish(concat(...parts), expect);
    },
    stage: (id) => stages.open(id),
    async stat(id) {
      const file = objects.get(id);
      return file
        ? { id, size: file.bytes.length, mtimeMs: file.mtimeMs }
        : null;
    },
    async open(id) {
      const bytes = requireFile(objects, id).bytes;
      return {
        size: bytes.length,
        async read(offset, len) {
          return bytes.slice(offset, offset + len);
        },
        async close() {},
      };
    },
    localPath: () => null,
    async delete(id) {
      return objects.delete(id);
    },
    async *list() {
      for (const [id, file] of objects)
        yield { id, size: file.bytes.length, mtimeMs: file.mtimeMs };
    },
    async sweepStages(age) {
      const cutoff = now() - age;
      let removed = 0;
      for (const id of pending.keys())
        await stages.locks.run(id, async () => {
          const file = pending.get(id);
          if (file && file.mtimeMs < cutoff) {
            pending.delete(id);
            stages.invalidate(id);
            removed++;
          }
        });
      return removed;
    },
    async sweepTrash() {
      return 0;
    },
  });
}
