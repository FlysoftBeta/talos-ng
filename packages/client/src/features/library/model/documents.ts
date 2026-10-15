import { AppError } from "@talos/base";
import { contract } from "@talos/contract";
import type { ResultOf } from "@talos/contract";
import { PackReader } from "@talos/docpack";
import type {
  RuntimeCommandPort,
  RuntimeFilePort,
  RuntimeQueryPort,
} from "../../../core/runtime-port.ts";

export type OpenDocument = ResultOf<typeof contract.library.doc.open>;
export const documentKey = (id: string): string => `library:${id}:manifest`;
type Descriptor = Omit<OpenDocument, "manifest">;

/** One ranged HTTP read (inclusive byte range); the browser fetch lives in an adapter. */
export interface RangeResponse {
  status: number;
  contentRange: string | null;
  bytes: Uint8Array;
}
export type RangeFetch = (
  url: string,
  first: number,
  last: number,
) => Promise<RangeResponse>;
/** What reading a document pack needs: commands, local ranges and ranged transport. */
export interface DocumentReadPort
  extends
    Pick<RuntimeCommandPort, "command" | "can">,
    Pick<RuntimeFilePort, "readFileRange">,
    Pick<RuntimeQueryPort, "getSnapshot"> {
  fetchRange: RangeFetch;
}

/** Ranged reader over a document pack: local bytes first, then verified 1 MiB HTTP ranges. */
export function rangedPack(
  port: DocumentReadPort,
  document: Descriptor,
): Promise<PackReader> {
  const user = port.getSnapshot().user?.id;
  return PackReader.open({
    size: document.pack.size,
    read: async (offset, length) => {
      if (port.getSnapshot().user?.id !== user)
        throw new AppError("E_CANCELLED", "旧会话请求已取消");
      const local = await port.readFileRange(
        document.pack.id,
        offset,
        offset + length,
      );
      if (local) return local;
      if (!port.can(contract.library.doc.open).ok)
        throw new AppError("E_UNAVAILABLE", "离线未缓存");
      const output = new Uint8Array(length);
      for (let at = 0; at < length; at += 1024 * 1024) {
        const end = Math.min(offset + length, offset + at + 1024 * 1024);
        const response = await port.fetchRange(
          document.download.url,
          offset + at,
          end - 1,
        );
        if (
          response.status !== 206 ||
          response.contentRange !==
            `bytes ${offset + at}-${end - 1}/${document.pack.size}`
        )
          throw new AppError("E_UNAVAILABLE", "文档下载失败，请重新打开");
        const bytes = response.bytes;
        if (bytes.length !== end - offset - at)
          throw new AppError("E_INTEGRITY", "文档资源传输不完整");
        if (port.getSnapshot().user?.id !== user)
          throw new AppError("E_CANCELLED", "旧会话请求已取消");
        output.set(bytes, at);
      }
      return output;
    },
  });
}
/** Opens a document; metadata too large for one RPC falls back to the pack's own manifest. */
export async function describeDocument(
  port: DocumentReadPort,
  id: string,
): Promise<OpenDocument> {
  try {
    const value = await port.command(contract.library.doc.open, { doc: id });
    if ("queued" in value) throw new AppError("E_INTERNAL", "文档打开状态无效");
    return value;
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "E_TOO_LARGE")
      throw error;
    const descriptor = await port.command(contract.library.doc.describe, {
      doc: id,
    });
    if ("queued" in descriptor)
      throw new AppError("E_INTERNAL", "文档打开状态无效");
    const pack = await rangedPack(port, descriptor);
    return { ...descriptor, manifest: pack.clientManifest() };
  }
}
