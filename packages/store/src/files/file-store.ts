import { AppError } from "@talos/base";
import type { Database } from "../database/database.ts";
import { CHUNK_SIZE } from "./file-schema.ts";
import type { Chunk, FileHead, Owner } from "./file-schema.ts";
import { FileEngine } from "./file-engine.ts";
import { createWriter } from "./file-writer.ts";
import { collect } from "./file-gc.ts";
import { validRid, validSize } from "./file-types.ts";
import type { FileStoreOptions, FileWriter, FileUsage } from "./file-types.ts";
import { storageError } from "../errors.ts";
export type {
  FileStoreOptions,
  FileWriter,
  FileUsage,
  LockManagerLike,
} from "./file-types.ts";
export class FileStore {
  private readonly engine: FileEngine;
  constructor(
    private readonly db: Database,
    private readonly options: FileStoreOptions = {},
  ) {
    this.engine = new FileEngine(db, options);
  }
  begin(rid: string, size: number): Promise<FileWriter> {
    return createWriter(this.engine, rid, size);
  }
  gc(options: {
    incompleteOlderThanMs: number;
  }): Promise<{ files: number; bytes: number }> {
    return collect(this.engine, options);
  }
  async put(rid: string, input: ArrayBuffer | Uint8Array): Promise<void> {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const writer = await this.begin(rid, bytes.length);
    try {
      if (writer.written < bytes.length)
        await writer.append(bytes.subarray(writer.written));
      await writer.commit();
    } catch (error) {
      try {
        await writer.close();
      } catch {
        /* Preserve the primary error. */
      }
      throw error;
    }
  }
  stat(rid: string): Promise<FileHead | undefined> {
    validRid(rid);
    return this.db.table<FileHead, string>("file_heads").get(rid);
  }
  async has(rid: string): Promise<boolean> {
    return (await this.stat(rid))?.state === "complete";
  }
  async read(
    rid: string,
    range: { start?: number; end?: number } = {},
  ): Promise<ArrayBuffer> {
    validRid(rid);
    return this.db.tx(["file_heads", "file_chunks"], "readonly", (tx) =>
      tx
        .table<FileHead, string>("file_heads")
        .get(rid)
        .then((head) => {
          if (head?.state !== "complete")
            throw new AppError("E_NOT_FOUND", "File is not complete");
          const start = range.start ?? 0;
          const end = range.end ?? head.size;
          validSize(start);
          validSize(end);
          if (start > end || end > head.size)
            throw new AppError(
              "E_INVALID",
              "Invalid byte range (end is exclusive)",
            );
          const result = new Uint8Array(end - start);
          const keys: IDBValidKey[] = [];
          if (end > start)
            for (
              let n = Math.floor(start / CHUNK_SIZE);
              n < Math.ceil(end / CHUNK_SIZE);
              n++
            )
              keys.push([rid, n]);
          return tx
            .table<Chunk>("file_chunks")
            .getMany(keys)
            .then((chunks) => {
              let offset = 0;
              chunks.forEach((chunk, i) => {
                const n = Math.floor(start / CHUNK_SIZE) + i;
                if (
                  !chunk ||
                  chunk.bytes.byteLength !==
                    Math.min(CHUNK_SIZE, head.size - n * CHUNK_SIZE)
                )
                  throw new AppError(
                    "E_INTEGRITY",
                    "Missing or malformed file chunk",
                  );
                const lo = Math.max(start - n * CHUNK_SIZE, 0);
                const hi = Math.min(
                  end - n * CHUNK_SIZE,
                  chunk.bytes.byteLength,
                );
                const bytes = new Uint8Array(chunk.bytes, lo, hi - lo);
                result.set(bytes, offset);
                offset += bytes.length;
              });
              return result.buffer;
            });
        }),
    );
  }
  async *readChunks(rid: string): AsyncIterableIterator<ArrayBuffer> {
    const head = await this.stat(rid);
    if (head?.state !== "complete")
      throw new AppError("E_NOT_FOUND", "File is not complete");
    for (let n = 0; n < head.chunks; n++)
      yield await this.read(rid, {
        start: n * CHUNK_SIZE,
        end: Math.min(head.size, (n + 1) * CHUNK_SIZE),
      });
  }
  retain(owner: string, rid: string): Promise<void> {
    validRid(rid);
    if (!owner)
      return Promise.reject(
        new AppError("E_INVALID", "Owner must not be empty"),
      );
    return this.db.tx(["file_heads", "file_owners"], "readwrite", (tx) =>
      tx
        .table<FileHead, string>("file_heads")
        .get(rid)
        .then((head) => {
          if (!head || head.state === "deleting")
            throw new AppError("E_NOT_FOUND", "Cannot retain a missing file");
          return tx
            .table<Owner>("file_owners")
            .put({ owner, rid })
            .then(() => undefined);
        }),
    );
  }
  release(owner: string, rid: string): Promise<void> {
    validRid(rid);
    return this.db.table<Owner>("file_owners").delete([owner, rid]);
  }
  releaseOwner(owner: string): Promise<void> {
    return this.db
      .table<Owner>("file_owners")
      .deleteRange({ lower: [owner], upper: [owner, []] });
  }
  async owners(rid: string): Promise<string[]> {
    validRid(rid);
    return (
      await this.db
        .table<Owner>("file_owners")
        .byIndex<string>("rid")
        .range({ lower: rid, upper: rid })
    ).map((row) => row.owner);
  }
  async listByOwnerPrefix(prefix: string): Promise<Owner[]> {
    // A cursor starting at the prefix also handles prefixes ending in U+FFFF.
    return (
      await this.db.table<Owner>("file_owners").range({ lower: [prefix] })
    ).filter((row) => row.owner.startsWith(prefix));
  }
  usage(): Promise<FileUsage> {
    return this.db.tx(["file_heads", "file_owners"], "readonly", (tx) =>
      tx
        .table<FileHead>("file_heads")
        .range()
        .then((heads) =>
          tx
            .table<Owner>("file_owners")
            .range()
            .then((owners) => {
              const result: FileUsage = {
                bytes: 0,
                files: 0,
                byOwnerPrefix: Object.create(null) as Record<string, number>,
              };
              const sizes = new Map<string, number>();
              for (const head of heads) {
                result.bytes += head.written;
                result.files++;
                sizes.set(head.rid, head.written);
              }
              const counted = new Set<string>();
              for (const { owner, rid } of owners) {
                const prefix = owner.split(":")[0]!;
                const key = JSON.stringify([prefix, rid]);
                if (counted.has(key)) continue;
                counted.add(key);
                result.byOwnerPrefix[prefix] =
                  (result.byOwnerPrefix[prefix] ?? 0) + (sizes.get(rid) ?? 0);
              }
              return result;
            }),
        ),
    );
  }
  async estimate(): Promise<{ usage?: number; quota?: number } | undefined> {
    const estimate =
      this.options.estimate === undefined
        ? typeof navigator !== "undefined" && navigator.storage?.estimate
          ? () => navigator.storage.estimate()
          : undefined
        : this.options.estimate;
    try {
      return estimate ? await estimate() : undefined;
    } catch (error) {
      throw storageError(error);
    }
  }
}
