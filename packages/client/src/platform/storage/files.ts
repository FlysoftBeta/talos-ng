import { FileStore } from "@talos/store";
import type { Database } from "@talos/store";
export function createFiles(db: Database, now: () => number): FileStore {
  return new FileStore(db, { clock: now });
}
