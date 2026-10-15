import { AppError, Semaphore } from "@talos/base";
import fs from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { CHUNK_SIZE } from "../content/stream.ts";
import { errorCode } from "../errors.ts";
import type { RandomAccess } from "../ports.ts";

export async function fileStat(path: string): Promise<Stats | null> {
  try {
    const stat = await fs.lstat(path);
    if (!stat.isFile())
      throw new AppError("E_INTEGRITY", "Expected a regular store file");
    return stat;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}
export async function writeBytes(
  handle: FileHandle,
  chunk: Uint8Array,
  offset: number,
): Promise<void> {
  let written = 0;
  while (written < chunk.byteLength) {
    const { bytesWritten } = await handle.write(
      chunk,
      written,
      chunk.byteLength - written,
      offset + written,
    );
    if (bytesWritten === 0)
      throw new AppError("E_INTERNAL", "File write made no progress");
    written += bytesWritten;
  }
}
export async function openFile(path: string): Promise<RandomAccess> {
  await fileStat(path);
  const handle = await fs.open(path, "r");
  try {
    const { size } = await handle.stat();
    const lock = new Semaphore(1);
    return {
      size,
      read: (offset, len) =>
        lock.run(async () => {
          const result = new Uint8Array(len);
          let read = 0;
          while (read < len) {
            const { bytesRead } = await handle.read(
              result,
              read,
              len - read,
              offset + read,
            );
            if (bytesRead === 0)
              throw new AppError(
                "E_INTEGRITY",
                "Object was truncated during read",
              );
            read += bytesRead;
          }
          return result;
        }),
      close: () => lock.run(() => handle.close()),
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
export async function* fileChunks(path: string): AsyncIterable<Uint8Array> {
  const reader = await openFile(path);
  try {
    for (let at = 0; at < reader.size; at += CHUNK_SIZE)
      yield await reader.read(at, Math.min(CHUNK_SIZE, reader.size - at));
  } finally {
    await reader.close();
  }
}
export async function* entries(path: string): AsyncIterable<Dirent> {
  let dir: Awaited<ReturnType<typeof fs.opendir>>;
  try {
    dir = await fs.opendir(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  // Node's directory iterator closes its handle even when the consumer stops early.
  for await (const entry of dir) yield entry;
}
export async function removeFile(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}
export async function syncDirectory(path: string): Promise<void> {
  // Windows does not expose a portable directory fsync through Node.
  if (process.platform === "win32") return;
  const handle = await fs.open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
