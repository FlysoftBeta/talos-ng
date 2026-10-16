import { AppError } from "@talos/base";
import type { FileWriter } from "@talos/store";

/** Bounded, resumable HTTP delivery. The caller owns the writer and its lease. */
export async function fetchFileRanges(options: {
  url: string;
  size: number;
  writer: FileWriter;
  fetch: typeof fetch;
  assertActive: () => void;
  progress?: (written: number, total: number) => void;
}): Promise<void> {
  const { writer, size, assertActive } = options;
  if (!Number.isSafeInteger(size) || size < 0 || writer.written > size)
    throw new AppError("E_INVALID", "下载大小无效");
  options.progress?.(writer.written, size);
  while (writer.written < size) {
    assertActive();
    const start = writer.written;
    const end = Math.min(size, start + 1024 * 1024);
    const controller = new AbortController();
    // Bound time without network progress, rather than the complete file's
    // duration. A stalled request must not hold the file lease and retry queue.
    const networkStep = async <T>(pending: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          pending,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              reject(new AppError("E_TIMEOUT", "下载超时，请稍后重试"));
              controller.abort();
            }, 30_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    const response = await networkStep(
      options.fetch(options.url, {
        headers: { Range: `bytes=${start}-${end - 1}` },
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      }),
    );
    try {
      assertActive();
      if (response.status === 401 || response.status === 403)
        throw new AppError("E_DENIED", "下载授权已失效，请重新获取下载链接");
      if (response.status === 404 || response.status === 410)
        throw new AppError("E_NOT_FOUND", "下载内容已不存在");
      if (response.status === 429)
        throw new AppError("E_RATE_LIMITED", "下载请求过于频繁，请稍后重试");
      if (response.status >= 500)
        throw new AppError("E_UNAVAILABLE", "下载服务暂时不可用，请稍后重试");
      if (
        response.status !== 206 ||
        response.headers.get("Content-Range") !==
          `bytes ${start}-${end - 1}/${size}`
      )
        throw new AppError("E_PROTOCOL", "服务器未返回请求的下载范围");
    } catch (error) {
      await response.body?.cancel().catch(() => undefined);
      throw error;
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AppError("E_PROTOCOL", "下载响应没有内容");
    const bytes = new Uint8Array(end - start);
    let offset = 0;
    try {
      while (true) {
        const result = await networkStep(reader.read());
        assertActive();
        if (result.done) break;
        if (offset + result.value.length > bytes.length)
          throw new AppError("E_PROTOCOL", "下载响应超出请求范围");
        bytes.set(result.value, offset);
        offset += result.value.length;
      }
      if (offset !== bytes.length)
        throw new AppError("E_PROTOCOL", "下载响应不完整");
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    assertActive();
    await writer.append(bytes);
    options.progress?.(writer.written, size);
  }
  assertActive();
  await writer.commit();
  assertActive();
}
