import { AppError, concat } from "@talos/base";
import { CHUNK_SIZE, hashStream } from "../content/stream.ts";
import { validateId, validateStageId } from "../content/identity.ts";
import {
  checkedRange,
  validateExpect,
  validateSize,
} from "../content/validation.ts";
import { asAppError, guard } from "../errors.ts";
import type { ManagedObjectStore, RandomAccess } from "../ports.ts";

export type Backend = Pick<
  ManagedObjectStore,
  | "beginBulk"
  | "put"
  | "stage"
  | "stat"
  | "open"
  | "localPath"
  | "delete"
  | "list"
  | "sweepStages"
  | "sweepTrash"
>;
export function createStore(backend: Backend): ManagedObjectStore {
  const store: ManagedObjectStore = {
    ...(backend.beginBulk ? { beginBulk: backend.beginBulk } : {}),
    put: (src, expect) =>
      guard(async () => {
        validateExpect(expect);
        return backend.put(src, expect);
      }),
    stage: (id) =>
      guard(async () => {
        validateStageId(id);
        return backend.stage(id);
      }),
    stat: (id) =>
      guard(async () => {
        validateId(id);
        return backend.stat(id);
      }),
    has: async (id) => (await store.stat(id)) !== null,
    open: (id) =>
      guard(async () => {
        validateId(id);
        const reader = await backend.open(id);
        return protectReader(reader);
      }),
    localPath: (id) => {
      validateId(id);
      return backend.localPath(id);
    },
    delete: (id) =>
      guard(async () => {
        validateId(id);
        return backend.delete(id);
      }),
    async *list() {
      try {
        yield* backend.list();
      } catch (error) {
        throw asAppError(error);
      }
    },
    async *read(id, range) {
      const reader = await store.open(id);
      try {
        const { start, end } = checkedRange(reader.size, range);
        for (let at = start; at < end; at += CHUNK_SIZE)
          yield await reader.read(at, Math.min(CHUNK_SIZE, end - at));
      } finally {
        await reader.close();
      }
    },
    readAll: (id, range) =>
      guard(async () => {
        const parts: Uint8Array[] = [];
        for await (const part of store.read(id, range)) parts.push(part);
        return concat(...parts);
      }),
    verify: async (id) => {
      try {
        return (await hashStream(store.read(id))).id === id;
      } catch (error) {
        if (error instanceof AppError && error.code === "E_NOT_FOUND")
          return false;
        throw error;
      }
    },
    sweepStages: (age) =>
      guard(async () => {
        validateSize(age);
        return backend.sweepStages(age);
      }),
    sweepTrash: () => guard(() => backend.sweepTrash()),
    usage: async () => {
      let objects = 0,
        bytes = 0;
      for await (const info of store.list()) {
        objects++;
        bytes += info.size;
      }
      return { objects, bytes };
    },
  };
  return store;
}
function protectReader(reader: RandomAccess): RandomAccess {
  let closed = false;
  let closing: Promise<void> | undefined;
  return {
    size: reader.size,
    read: (offset, len) =>
      guard(async () => {
        if (closed) throw new AppError("E_CONFLICT", "Reader is closed");
        validateSize(len);
        checkedRange(reader.size, { start: offset, end: offset + len });
        return reader.read(offset, len);
      }),
    close: () => {
      if (!closing) {
        closed = true;
        closing = guard(() => reader.close());
      }
      return closing;
    },
  };
}
