import { AppError, Sha256, toHex } from "@talos/base";
import type { FileEngine } from "./file-engine.ts";
import { CHUNK_SIZE, FILE_TABLES } from "./file-schema.ts";
import type { Chunk, FileHead, Lease } from "./file-schema.ts";
import { validRid, validSize } from "./file-types.ts";
import type { FileWriter } from "./file-types.ts";
import { storageError } from "../errors.ts";
export async function createWriter(
  engine: FileEngine,
  rid: string,
  size: number,
): Promise<FileWriter> {
  validRid(rid);
  validSize(size);
  const token = engine.token();
  const head = await engine.locked(rid, () =>
    engine.db.tx(FILE_TABLES, "readwrite", (tx) =>
      tx
        .table<Lease, string>("file_leases")
        .get(rid)
        .then((lease) => {
          if (lease && lease.expires > engine.clock())
            throw new AppError("E_BUSY", "File has an active writer");
          return tx
            .table<FileHead, string>("file_heads")
            .get(rid)
            .then((existing) => {
              if (existing && existing.size !== size)
                throw new AppError("E_CONFLICT", "Existing file size differs");
              if (existing?.state === "deleting")
                throw new AppError("E_BUSY", "File is being collected");
              const head: FileHead = existing ?? {
                rid,
                size,
                written: 0,
                chunks: 0,
                state: "incomplete",
                updatedAt: engine.clock(),
              };
              tx.table<FileHead>("file_heads").put({
                ...head,
                updatedAt: engine.clock(),
              });
              tx.table<Lease>("file_leases").put({
                rid,
                token,
                expires: engine.clock() + engine.leaseMs,
              });
              return head;
            });
        }),
    ),
  );
  let written = head.written;
  let closed = false;
  let busy = false;
  const run = async (fn: () => Promise<void>): Promise<void> => {
    if (closed) throw new AppError("E_INVALID", "Writer is closed");
    if (busy)
      throw new AppError("E_BUSY", "Await the previous writer operation");
    busy = true;
    try {
      await fn();
    } finally {
      busy = false;
    }
  };
  return {
    get written(): number {
      return written;
    },
    append: (input) =>
      run(async () => {
        const bytes = new Uint8Array(
          input instanceof Uint8Array ? input : new Uint8Array(input),
        );
        written = await engine.fence(rid, token, (tx) =>
          tx
            .table<FileHead, string>("file_heads")
            .get(rid)
            .then((current) => {
              if (!current || current.state !== "incomplete")
                throw new AppError(
                  "E_INVALID",
                  "Cannot append to a complete or missing file",
                );
              if (current.written !== written)
                throw new AppError("E_CONFLICT", "Writer offset changed");
              if (bytes.length > size - written)
                throw new AppError("E_INVALID", "Append exceeds declared size");
              const chunks = tx.table<Chunk, IDBValidKey>("file_chunks");
              const n = Math.floor(written / CHUNK_SIZE);
              const offset = written % CHUNK_SIZE;
              return chunks.get([rid, n]).then((previous) => {
                if (
                  offset &&
                  (!previous || previous.bytes.byteLength !== offset)
                )
                  throw new AppError(
                    "E_INTEGRITY",
                    "Missing or malformed partial chunk",
                  );
                let consumed = 0;
                let index = n;
                while (consumed < bytes.length) {
                  const prefix = index === n ? offset : 0;
                  const length = Math.min(
                    CHUNK_SIZE - prefix,
                    bytes.length - consumed,
                  );
                  const chunk = new Uint8Array(prefix + length);
                  if (prefix) chunk.set(new Uint8Array(previous!.bytes));
                  chunk.set(
                    bytes.subarray(consumed, consumed + length),
                    prefix,
                  );
                  chunks.put({ rid, n: index++, bytes: chunk.buffer });
                  consumed += length;
                }
                const end = written + bytes.length;
                tx.table<FileHead>("file_heads").put({
                  ...current,
                  written: end,
                  chunks: Math.ceil(end / CHUNK_SIZE),
                  updatedAt: engine.clock(),
                });
                return end;
              });
            }),
        );
      }),
    commit: () =>
      run(async () => {
        const current = await engine.fence(rid, token, (tx) =>
          tx.table<FileHead, string>("file_heads").get(rid),
        );
        if (!current) throw new AppError("E_NOT_FOUND", "File disappeared");
        try {
          if (
            current.written !== size ||
            current.chunks !== Math.ceil(size / CHUNK_SIZE)
          ) {
            throw new AppError("E_INTEGRITY", "File size mismatch");
          }
          let hash: string;
          if (engine.subtle && size <= 8 * CHUNK_SIZE) {
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (let n = 0; n < current.chunks; n++) {
              const chunk = await writerChunk(engine, rid, token, n, size);
              bytes.set(new Uint8Array(chunk), offset);
              offset += chunk.byteLength;
            }
            hash = toHex(
              new Uint8Array(
                await engine.subtle.digest("SHA-256", bytes.buffer),
              ),
            );
          } else {
            const digest = new Sha256();
            for (let n = 0; n < current.chunks; n++)
              digest.update(
                new Uint8Array(await writerChunk(engine, rid, token, n, size)),
              );
            hash = digest.digestHex();
          }
          if (hash !== rid) {
            throw new AppError("E_INTEGRITY", "File SHA-256 mismatch");
          }
        } catch (error) {
          if (error instanceof AppError && error.code === "E_INTEGRITY") {
            await engine.remove(rid, token);
            closed = true;
          }
          throw storageError(error);
        }
        await engine.fence(rid, token, (tx) => {
          tx.table<FileHead>("file_heads").put({
            ...current,
            state: "complete",
            updatedAt: engine.clock(),
          });
          return tx.table<Lease, string>("file_leases").delete(rid);
        });
        closed = true;
      }),
    close: () =>
      run(async () => {
        await engine.db.tx(["file_leases"], "readwrite", (tx) =>
          tx
            .table<Lease, string>("file_leases")
            .get(rid)
            .then((lease) => {
              if (lease?.token === token)
                return tx.table<Lease, string>("file_leases").delete(rid);
            }),
        );
        closed = true;
      }),
  };
}
function writerChunk(
  engine: FileEngine,
  rid: string,
  token: string,
  n: number,
  size: number,
): Promise<ArrayBuffer> {
  return engine.fence(rid, token, (tx) =>
    tx
      .table<Chunk>("file_chunks")
      .get([rid, n])
      .then((chunk) => {
        if (
          !chunk ||
          chunk.bytes.byteLength !== Math.min(CHUNK_SIZE, size - n * CHUNK_SIZE)
        )
          throw new AppError("E_INTEGRITY", "Missing or malformed file chunk");
        return chunk.bytes;
      }),
  );
}
