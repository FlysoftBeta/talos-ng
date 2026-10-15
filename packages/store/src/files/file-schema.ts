export const CHUNK_SIZE = 1024 * 1024;
export const FILE_TABLES = [
  "file_heads",
  "file_chunks",
  "file_owners",
  "file_leases",
] as const;
export interface FileHead {
  rid: string;
  size: number;
  written: number;
  chunks: number;
  state: "incomplete" | "complete" | "deleting";
  updatedAt: number;
}
export interface Chunk {
  rid: string;
  n: number;
  bytes: ArrayBuffer;
}
export interface Owner {
  owner: string;
  rid: string;
}
export interface Lease {
  rid: string;
  token: string;
  expires: number;
}
/** Call once from a synchronous schema migration. */
export function createFileStores(tx: IDBTransaction): void {
  tx.db.createObjectStore("file_heads", { keyPath: "rid" });
  tx.db.createObjectStore("file_chunks", { keyPath: ["rid", "n"] });
  tx.db
    .createObjectStore("file_owners", { keyPath: ["owner", "rid"] })
    .createIndex("rid", "rid");
  tx.db.createObjectStore("file_leases", { keyPath: "rid" });
}
