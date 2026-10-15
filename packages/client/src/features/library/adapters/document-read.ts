import type { RuntimePort } from "../../../core/runtime-port.ts";
import type { DocumentReadPort, RangeFetch } from "../model/documents.ts";

/** Browser transport for ranged pack reads. */
export const browserRangeFetch: RangeFetch = async (url, first, last) => {
  const response = await fetch(url, {
    headers: { Range: `bytes=${first}-${last}` },
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
