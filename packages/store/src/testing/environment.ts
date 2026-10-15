import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { openDb } from "../database/database.ts";
import type { Database, DbOptions } from "../database/database.ts";
/** Each environment owns a fresh fake factory; reuse it to simulate tabs. */
export function createTestEnvironment(): {
  indexedDB: IDBFactory;
  keyRange: typeof IDBKeyRange;
  open: (
    options: Omit<DbOptions, "indexedDB" | "keyRange">,
  ) => Promise<Database>;
} {
  const indexedDB = new IDBFactory();
  return {
    indexedDB,
    keyRange: IDBKeyRange,
    open: (options) =>
      openDb({
        ...options,
        indexedDB,
        keyRange: IDBKeyRange,
        channel: options.channel ?? null,
      }),
  };
}
