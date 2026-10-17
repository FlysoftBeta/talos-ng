import { AppError, utf8Encode } from "@talos/base";
import { contract } from "@talos/contract";
import type {
  RuntimeCommandPort,
  RuntimeStatusPort,
} from "../../../core/runtime-port.ts";

export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;
// UTF-8 CJK expands beyond the RPC header limit long before the character limit,
// so large pasted text travels the same binary path as an attachment.
const INLINE_TEXT_BYTES = 64 * 1024;

/** Bytes of a document to upload; a browser file is adapted to this shape. */
export interface ImportSource {
  name: string;
  size: number;
  read(start: number, end: number): Promise<Uint8Array>;
}
export type ImportPort = Pick<RuntimeCommandPort, "command" | "operation"> &
  Pick<RuntimeStatusPort, "setTransfer">;

export function attachmentError(size: number): string | undefined {
  return size > MAX_IMPORT_BYTES ? "文档不能超过 200 MiB" : undefined;
}
export const titleFromFileName = (name: string): string =>
  name.replace(/\.[^.]+$/, "");
export const canStartImport = (
  title: string,
  body: string,
  hasFile: boolean,
): boolean => !!title.trim() && (!!body.trim() || hasFile);

function textSource(title: string, body: string): ImportSource {
  const bytes = utf8Encode(body);
  return {
    name: `${title}.txt`,
    size: bytes.length,
    read: async (start, end) => bytes.slice(start, end),
  };
}
/**
 * Imports a document as text or a resumable chunked upload. Progress and failures are
 * reported through the download status list; the call itself never rejects.
 */
export async function importDocument(
  port: ImportPort,
  input: {
    title: string;
    body: string;
    source?: ImportSource;
    collection?: string;
  },
): Promise<void> {
  const { title, body, collection } = input;
  let source = input.source;
  if (!source && utf8Encode(body).length > INLINE_TEXT_BYTES)
    source = textSource(title, body);
  const id = `import:${port.operation().op}`;
  const label = `上传 ${title}`;
  let cancelled = false,
    uploadId: string | undefined;
  const publish = (progress: number, error?: string) =>
    port.setTransfer(id, {
      title: label,
      direction: "upload",
      progress,
      ...(error === undefined
        ? {
            cancel: () => {
              cancelled = true;
            },
          }
        : {
            error,
            retry: () => {
              port.setTransfer(id, undefined);
              void importDocument(port, input);
            },
            cancel: () => port.setTransfer(id, undefined),
          }),
    });
  publish(0);
  try {
    if (source) {
      if (source.size > MAX_IMPORT_BYTES)
        throw new AppError("E_TOO_LARGE", "文档不能超过 200 MiB");
      const begin = await port.command(contract.upload.begin, {
        kind: "document",
        size: source.size,
      });
      if ("queued" in begin) return;
      uploadId = begin.id;
      for (let offset = begin.offset; offset < source.size;) {
        if (cancelled) throw new AppError("E_CANCELLED", "已取消");
        const bytes = await source.read(
          offset,
          Math.min(offset + CHUNK_BYTES, source.size),
        );
        const part = await port.command(
          contract.upload.append,
          { id: begin.id, offset },
          { body: bytes },
        );
        if ("queued" in part) return;
        offset = part.offset;
        publish(offset / source.size);
      }
      await port.command(contract.upload.commit, { id: begin.id });
      await port.command(contract.library.doc.importFile, {
        title,
        name: source.name,
        upload: begin.id,
        collection,
      });
    } else
      await port.command(contract.library.doc.importText, {
        title,
        body,
        collection,
      });
    port.setTransfer(id, undefined);
  } catch (error) {
    if (cancelled) {
      if (uploadId)
        await port
          .command(contract.upload.abort, { id: uploadId })
          .catch(() => undefined);
      port.setTransfer(id, undefined);
      return;
    }
    publish(0, error instanceof Error ? error.message : "导入失败");
  }
}
