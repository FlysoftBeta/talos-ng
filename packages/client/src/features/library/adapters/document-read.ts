import { AppError } from "@talos/base";
import type { RuntimePort } from "../../../core/runtime-port.ts";
import type { DocumentReadPort, RangeFetch } from "../model/documents.ts";

/** A stalled range (at most 1 MiB) fails instead of leaving its page loading forever. */
const RANGE_TIMEOUT_MS = 60_000;
/** Browser transport for ranged pack reads. */
export const browserRangeFetch: RangeFetch = async (url, first, last) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RANGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=${first}-${last}` },
      signal: controller.signal,
    });
    const contentRange = response.headers.get("content-range");
    return {
      status: response.status,
      contentRange,
      bytes:
        response.status === 206
          ? new Uint8Array(await response.arrayBuffer())
          : new Uint8Array(0),
    };
  } catch (error) {
    if (controller.signal.aborted)
      throw new AppError("E_TIMEOUT", "文档下载超时，请重试");
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
/** Binds the runtime's document-reading capabilities to the browser transport. */
export function documentReadPort(runtime: RuntimePort): DocumentReadPort {
  return {
    command: runtime.command,
    can: runtime.can,
    readFileRange: runtime.readFileRange,
    getSnapshot: runtime.getSnapshot,
    fetchRange: browserRangeFetch,
  };
}
