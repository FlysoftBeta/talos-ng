import { AppError } from "@talos/base";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";

export const BACKUP_MAGIC = "TALOS-BACKUP-2\n";
export const BACKUP_CHUNK = 64 * 1024;
const zeroChunk = Buffer.alloc(BACKUP_CHUNK);
export interface BackupEntry {
  path: string;
  size: number;
  sha256: string;
}
export function entryLine(entry: BackupEntry): Buffer {
  return Buffer.from(JSON.stringify(entry) + "\n");
}
export function parseEntry(line: string): BackupEntry {
  let entry: BackupEntry;
  try {
    entry = JSON.parse(line) as BackupEntry;
  } catch {
    throw new AppError("E_INVALID", "备份清单无效");
  }
  if (
    !entry ||
    (entry.path !== "talos.db" &&
      !/^objects\/[a-f0-9]{64}$/.test(entry.path)) ||
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    (entry.path.startsWith("objects/") && entry.sha256 !== entry.path.slice(8))
  )
    throw new AppError("E_INVALID", "备份文件无效");
  return entry;
}
/** A bounded reader: headers are small, payload bytes are never accumulated. */
export class BackupReader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private chunk: Uint8Array = new Uint8Array(0);
  private offset = 0;
  constructor(source: AsyncIterable<Uint8Array>) {
    this.iterator = source[Symbol.asyncIterator]();
  }
  private async available(): Promise<boolean> {
    while (this.offset === this.chunk.length) {
      const next = await this.iterator.next();
      if (next.done) return false;
      this.chunk = next.value;
      this.offset = 0;
    }
    return true;
  }
  async line(): Promise<string | undefined> {
    const bytes: number[] = [];
    while (await this.available()) {
      const byte = this.chunk[this.offset++]!;
      if (byte === 10) return Buffer.from(bytes).toString("utf8");
      if (bytes.length >= 1024) throw new AppError("E_INVALID", "备份头过长");
      bytes.push(byte);
    }
    if (bytes.length) throw new AppError("E_INTEGRITY", "备份头不完整");
    return undefined;
  }
  async *bytes(size: number): AsyncIterable<Uint8Array> {
    let left = size;
    while (left) {
      if (!(await this.available()))
        throw new AppError("E_INTEGRITY", "备份内容不完整");
      const count = Math.min(
        left,
        this.chunk.length - this.offset,
        BACKUP_CHUNK,
      );
      const piece = this.chunk.subarray(this.offset, this.offset + count);
      this.offset += count;
      left -= count;
      yield piece;
    }
  }
  async close(): Promise<void> {
    await this.iterator.return?.();
  }
}
export function fileBytes(path: string): AsyncIterable<Uint8Array> {
  return createReadStream(path, { highWaterMark: BACKUP_CHUNK });
}
export async function hashFile(
  path: string,
): Promise<{ size: number; sha256: string }> {
  let size = 0;
  const hash = createHash("sha256");
  for await (const bytes of fileBytes(path)) {
    size += bytes.length;
    hash.update(bytes);
  }
  return { size, sha256: hash.digest("hex") };
}
/** Copy and validate incrementally, including partial-write handling. */
export async function copyChecked(
  source: AsyncIterable<Uint8Array>,
  target: string,
  expected?: Pick<BackupEntry, "size" | "sha256">,
): Promise<{ size: number; sha256: string }> {
  const file = await open(target, "wx");
  const hash = createHash("sha256");
  let size = 0;
  try {
    for await (const chunk of source) {
      for (let start = 0; start < chunk.length; start += BACKUP_CHUNK) {
        const bytes = chunk.subarray(start, start + BACKUP_CHUNK);
        size += bytes.length;
        if (expected && size > expected.size)
          throw new AppError("E_INTEGRITY", "备份大小不匹配");
        hash.update(bytes);
        // Preserve sparse zero extents (especially useful for large VM/data objects).
        if (
          Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).equals(
            zeroChunk.subarray(0, bytes.length),
          )
        )
          continue;
        let offset = 0;
        while (offset < bytes.length) {
          const result = await file.write(
            bytes,
            offset,
            bytes.length - offset,
            size - bytes.length + offset,
          );
          if (!result.bytesWritten)
            throw new AppError("E_UNAVAILABLE", "无法写入备份");
          offset += result.bytesWritten;
        }
      }
    }
    const sha256 = hash.digest("hex");
    if (expected && (size !== expected.size || sha256 !== expected.sha256))
      throw new AppError("E_INTEGRITY", "备份校验失败");
    await file.truncate(size);
    await file.sync();
    return { size, sha256 };
  } finally {
    await file.close();
  }
}
