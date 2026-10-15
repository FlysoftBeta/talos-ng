import { open, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { AppError } from "@talos/base";
import type { RandomAccess, Spool } from "@talos/docpack";
export async function removeTemp(path: string): Promise<void> {
  await rm(path, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 20,
  });
}
export class FileAccess implements RandomAccess {
  protected constructor(
    protected readonly handle: FileHandle,
    protected length: number,
  ) {}
  static async open(path: string): Promise<FileAccess> {
    const h = await open(path, "r");
    try {
      return new FileAccess(h, (await h.stat()).size);
    } catch (e) {
      await h.close();
      throw e;
    }
  }
  get size(): number {
    return this.length;
  }
  async read(offset: number, length: number): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset > this.size - length
    )
      throw new AppError("E_INTEGRITY", "文档数据范围无效");
    const out = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const { bytesRead } = await this.handle.read(
        out,
        done,
        length - done,
        offset + done,
      );
      if (!bytesRead) throw new AppError("E_INTEGRITY", "文档数据不完整");
      done += bytesRead;
    }
    return out;
  }
  async close(): Promise<void> {
    await this.handle.close();
  }
}
export class FileSpool extends FileAccess implements Spool {
  static async create(path: string): Promise<FileSpool> {
    return new FileSpool(await open(path, "wx+"), 0);
  }
  async append(bytes: Uint8Array): Promise<void> {
    let at = 0;
    while (at < bytes.length) {
      const { bytesWritten } = await this.handle.write(
        bytes,
        at,
        bytes.length - at,
        this.length,
      );
      if (!bytesWritten) throw new AppError("E_INTERNAL", "无法写入文档");
      at += bytesWritten;
      this.length += bytesWritten;
    }
  }
  async write(bytes: Uint8Array): Promise<void> {
    await this.append(bytes);
  }
  async sync(): Promise<void> {
    await this.handle.sync();
  }
}
