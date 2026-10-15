import { AppError } from "@talos/base";
import { integer, invalid } from "./manifest.ts";
export interface RandomAccess {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}
export interface PackSink {
  write(bytes: Uint8Array): Promise<void>;
}
export interface Spool extends RandomAccess {
  append(bytes: Uint8Array): Promise<void>;
}
/** Caller-owned append-only memory spool; reads and writes copy their bytes. */
export class MemorySpool implements Spool, PackSink {
  private chunks: { offset: number; bytes: Uint8Array }[] = [];
  private length = 0;
  get size(): number {
    return this.length;
  }
  async append(bytes: Uint8Array): Promise<void> {
    this.chunks.push({ offset: this.length, bytes: bytes.slice() });
    this.length += bytes.length;
  }
  async write(bytes: Uint8Array): Promise<void> {
    await this.append(bytes);
  }
  async read(offset: number, length: number): Promise<Uint8Array> {
    if (!integer(offset) || !integer(length) || offset > this.size - length)
      invalid("read range");
    const out = new Uint8Array(length);
    for (const c of this.chunks) {
      const start = Math.max(offset, c.offset),
        end = Math.min(offset + length, c.offset + c.bytes.length);
      if (start < end)
        out.set(
          c.bytes.subarray(start - c.offset, end - c.offset),
          start - offset,
        );
    }
    return out;
  }
}
export async function readExact(
  source: RandomAccess,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  if (!integer(offset) || !integer(length) || offset > source.size - length)
    throw new AppError("E_INTEGRITY", "文档数据不完整");
  const bytes = await source.read(offset, length);
  if (bytes.length !== length)
    throw new AppError("E_INTEGRITY", "文档数据不完整");
  return bytes;
}
