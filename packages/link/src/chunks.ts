import { AppError, deferred } from "@talos/base";
import type { CancellationSignal } from "@talos/base";
import type { Call, CallResult } from "./client.ts";
import { abortController } from "./runtime.ts";
export interface ChunkOptions {
  size: number;
  method: string;
  args?(offset: number, length: number): unknown;
  chunkSize?: number;
  window?: number;
  startOffset?: number;
  onProgress?(offset: number, size: number): void;
  signal?: CancellationSignal;
}
export interface UploadOptions extends ChunkOptions {
  read(offset: number, length: number): Uint8Array | Promise<Uint8Array>;
}
export interface DownloadOptions extends ChunkOptions {
  write(offset: number, bytes: Uint8Array): void | Promise<void>;
}
interface Chunk {
  offset: number;
  length: number;
  result: Promise<CallResult>;
}
async function pump(
  call: Call,
  options: ChunkOptions,
  upload?: UploadOptions,
  download?: DownloadOptions,
): Promise<number> {
  const size = options.size;
  const start = options.startOffset ?? 0;
  const chunkSize = options.chunkSize ?? 512 * 1024;
  const window = options.window ?? 3;
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start > size ||
    !Number.isSafeInteger(chunkSize) ||
    chunkSize < 1 ||
    chunkSize > 512 * 1024 ||
    !Number.isSafeInteger(window) ||
    window < 1 ||
    !options.method
  )
    throw new AppError("E_INVALID", "无效的分块传输参数");
  const controller = abortController();
  const failure = deferred<never>();
  let failed = false;
  // Every operation observes this rejection; keep it handled even before the first operation.
  void failure.promise.catch(() => {});
  const fail = (error: unknown) => {
    if (failed) return;
    failed = true;
    failure.reject(
      error instanceof AppError
        ? error
        : new AppError("E_INTERNAL", "分块传输失败"),
    );
    controller.abort();
  };
  const abort = () => fail(new AppError("E_CANCELLED", "操作已取消"));
  const race = <T>(operation: T | PromiseLike<T>): Promise<T> =>
    failed
      ? failure.promise
      : Promise.race([failure.promise, Promise.resolve(operation)]);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const queue: Chunk[] = [];
  let next = start;
  let completed = start;
  try {
    await race(undefined);
    while (next < size || queue.length) {
      while (queue.length < window && next < size) {
        const offset = next;
        const length = Math.min(chunkSize, size - offset);
        const body = upload
          ? await race(upload.read(offset, length))
          : undefined;
        if (body && body.length !== length)
          throw new AppError("E_INTEGRITY", "读取的分块大小不匹配");
        await race(undefined);
        const result = Promise.resolve(
          call(
            options.method,
            options.args ? options.args(offset, length) : { offset, length },
            { body, signal: controller.signal },
          ),
        );
        void result.catch(fail);
        queue.push({ offset, length, result });
        next += length;
      }
      const chunk = queue.shift();
      if (!chunk) break;
      const result = await race(chunk.result);
      if (download) {
        if (result.body.length !== chunk.length)
          throw new AppError("E_INTEGRITY", "收到的分块大小不匹配");
        await race(download.write(chunk.offset, result.body));
      }
      completed = chunk.offset + chunk.length;
      options.onProgress?.(completed, size);
    }
    return completed;
  } catch (error) {
    fail(error);
    return await failure.promise;
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}
export function uploadChunks(
  call: Call,
  options: UploadOptions,
): Promise<number> {
  return pump(call, options, options);
}
export function downloadChunks(
  call: Call,
  options: DownloadOptions,
): Promise<number> {
  return pump(call, options, undefined, options);
}
