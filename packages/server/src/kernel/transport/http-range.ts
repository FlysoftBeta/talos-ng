import { AppError } from "@talos/base";
import type { ByteRange } from "@talos/objectstore";

/** HTTP ends are inclusive; ObjectStore ends are exclusive. Only one range is accepted. */
export function parseHttpRange(value: string, size: number): ByteRange {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0)
    throw new AppError("E_INVALID", "无效的下载范围");
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0)
      throw new AppError("E_INVALID", "无效的下载范围");
    start = Math.max(0, size - suffix);
    end = size;
  } else {
    start = Number(match[1]);
    const inclusive = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(inclusive) ||
      inclusive < start ||
      start >= size
    )
      throw new AppError("E_INVALID", "无效的下载范围");
    end = Math.min(size, inclusive + 1);
  }
  return { start, end };
}
