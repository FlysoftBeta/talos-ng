import { AppError, createUlid } from "@talos/base";
import type { Database, Transaction } from "../database/database.ts";
import type { TxTask } from "../database/task.ts";
import { FILE_TABLES } from "./file-schema.ts";
import type { Chunk, FileHead, Lease, Owner } from "./file-schema.ts";
import { chunkRange } from "./file-types.ts";
import type { FileStoreOptions, LockManagerLike } from "./file-types.ts";
import { storageError } from "../errors.ts";
export class FileEngine {
  readonly clock: () => number;
  readonly token: () => string;
  readonly leaseMs: number;
  readonly locks: LockManagerLike | null | undefined;
  readonly subtle: Pick<SubtleCrypto, "digest"> | null | undefined;
  constructor(
    readonly db: Database,
    options: FileStoreOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.token = createUlid({ clock: this.clock, random: options.random });
    this.leaseMs = options.leaseMs ?? 30_000;
    if (!Number.isFinite(this.leaseMs) || this.leaseMs <= 0)
      throw new AppError("E_INVALID", "leaseMs must be positive");
    this.locks =
      options.locks === undefined
        ? typeof navigator === "undefined"
          ? undefined
          : navigator.locks
        : options.locks;
    this.subtle =
      options.subtle === undefined
        ? typeof crypto === "undefined"
          ? undefined
          : crypto.subtle
        : options.subtle;
  }
  async locked<T>(rid: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await (this.locks
        ? this.locks.request(`talos-file:${rid}`, fn)
        : fn());
    } catch (error) {
      throw storageError(error);
    }
  }
  fence<T>(
    rid: string,
    token: string,
    fn: (tx: Transaction) => TxTask<T>,
  ): Promise<T> {
    return this.locked(rid, () =>
      this.db.tx(FILE_TABLES, "readwrite", (tx) =>
        tx
          .table<Lease, string>("file_leases")
          .get(rid)
          .then((lease) => {
            if (
              !lease ||
              lease.token !== token ||
              lease.expires <= this.clock()
            )
              throw new AppError(
                "E_BUSY",
                "Writer lease expired or was replaced; begin again to resume",
              );
            tx.table<Lease>("file_leases").put({
              ...lease,
              expires: this.clock() + this.leaseMs,
            });
            return fn(tx);
          }),
      ),
    );
  }
  async remove(rid: string, token: string): Promise<void> {
    await this.fence(rid, token, (tx) =>
      tx
        .table<FileHead, string>("file_heads")
        .get(rid)
        .then((head) => {
          if (head)
            tx.table<FileHead>("file_heads").put({
              ...head,
              state: "deleting",
            });
        }),
    );
    let remaining = true;
    while (remaining) {
      remaining = await this.fence(rid, token, (tx) =>
        tx
          .table<Chunk>("file_chunks")
          .range({ ...chunkRange(rid), limit: 32 })
          .then((chunks) => {
            for (const chunk of chunks)
              tx.table<Chunk>("file_chunks").delete([rid, chunk.n]);
            if (chunks.length) return true;
            return tx
              .table<Owner>("file_owners")
              .byIndex<string>("rid")
              .range({ lower: rid, upper: rid, limit: 32 })
              .then((owners) => {
                for (const owner of owners)
                  tx.table<Owner>("file_owners").delete([owner.owner, rid]);
                if (owners.length) return true;
                tx.table<FileHead, string>("file_heads").delete(rid);
                tx.table<Lease, string>("file_leases").delete(rid);
                return false;
              });
          }),
      );
    }
  }
}
