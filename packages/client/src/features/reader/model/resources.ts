import { AppError, utf8Decode } from "@talos/base";
import { contract } from "@talos/contract";
import {
  RENDER_FORMAT,
  decodeResource,
  decodeResourceBatch,
} from "@talos/docpack";
import type { PackReader } from "@talos/docpack";
import type { ClientManifest, Unit } from "@talos/docpack";
import type {
  RuntimeCommandPort,
  RuntimeFilePort,
} from "../../../core/runtime-port.ts";
import {
  describeDocument,
  documentKey,
  rangedPack,
} from "../../library/index.ts";
import type { DocumentReadPort, OpenDocument } from "../../library/index.ts";

export type { OpenDocument };
/** Everything opening and reading a document needs; ranged transport is injected. */
export type DocumentSessionPort = DocumentReadPort &
  Pick<RuntimeCommandPort, "fetchBody"> &
  Pick<RuntimeFilePort, "getLocal" | "setLocal" | "hasFile">;
export class DocumentResources {
  private pack?: Promise<PackReader>;
  constructor(
    readonly runtime: DocumentSessionPort,
    readonly document: OpenDocument,
    private readonly retained: boolean,
  ) {}
  private packReader(): Promise<PackReader> {
    if (!this.pack) this.pack = rangedPack(this.runtime, this.document);
    return this.pack;
  }
  async resource(rid: string): Promise<Uint8Array> {
    const meta = this.document.manifest.resources[rid];
    if (!meta) throw new AppError("E_INTEGRITY", "页面资源不存在");
    if (this.retained || meta.stored > 500 * 1024)
      return (await this.packReader()).readDecoded(rid);
    if (!this.runtime.can(contract.library.doc.fetch).ok)
      throw new AppError("E_UNAVAILABLE", "离线未缓存");
    const reply = await this.runtime.fetchBody(contract.library.doc.fetch, {
      doc: this.document.document.id,
      rids: [rid],
    });
    const record = decodeResourceBatch(reply.body).find(
      (item) => item.rid === rid,
    );
    if (!record) throw new AppError("E_INTEGRITY", "页面资源传输不完整");
    return decodeResource(record.enc, record.bytes, { rid, size: meta.size });
  }
  async unit(
    unit: Unit,
    signal?: AbortSignal,
  ): Promise<{
    text: string;
    resources: { rid: string; mime: string; bytes: ArrayBuffer }[];
  }> {
    const check = (): void => {
      if (signal?.aborted)
        throw new AppError("E_CANCELLED", "页面已移出阅读窗口");
    };
    check();
    const text = utf8Decode(await this.resource(unit.entry));
    check();
    if (this.document.manifest.kind === "flow") return { text, resources: [] };
    const ids = Array.from(
      new Set([...this.document.manifest.shared, ...unit.deps]),
    ).filter((id) => id !== unit.entry);
    const resources = [];
    // A page retains only its own resource buffers; unmount drops the complete set.
    for (const rid of ids) {
      check();
      resources.push({
        rid,
        mime: this.document.manifest.resources[rid]!.mime,
        bytes: (await this.resource(rid)).slice().buffer as ArrayBuffer,
      });
      check();
    }
    return { text, resources };
  }
}
export async function openDocument(
  runtime: DocumentSessionPort,
  id: string,
): Promise<DocumentResources> {
  const user = runtime.getSnapshot().user?.id;
  const cached = await runtime.getLocal<OpenDocument>(documentKey(id));
  if (runtime.can(contract.library.doc.open).ok) {
    const value = await describeDocument(runtime, id);
    if (runtime.getSnapshot().user?.id !== user)
      throw new AppError("E_CANCELLED", "旧会话请求已取消");
    await runtime.setLocal(documentKey(id), value);
    return new DocumentResources(
      runtime,
      value,
      await runtime.hasFile(value.pack.id),
    );
  }
  // A pack rendered in another page format cannot be displayed; the server re-renders it.
  if (
    cached?.manifest.kind === "paged" &&
    cached.manifest.meta.renderFormat !== RENDER_FORMAT
  ) {
    await runtime.setLocal(documentKey(id), null);
    throw new AppError("E_UNAVAILABLE", "离线未缓存");
  }
  if (cached && (await runtime.hasFile(cached.pack.id)))
    return new DocumentResources(runtime, cached, true);
  throw new AppError("E_UNAVAILABLE", "离线未缓存");
}
export function estimateUnit(
  manifest: ClientManifest,
  unit: Unit,
  width: number,
  zoom: string,
): number {
  if (manifest.kind === "paged")
    return (
      Math.ceil(
        (unit.h ?? 1000) *
          (zoom === "fit"
            ? Math.max(100, width - 32) / (unit.w ?? 750)
            : Number(zoom)),
      ) + 24
    );
  return Math.max(
    80,
    Math.ceil(
      (unit.chars ?? 8000) / Math.max(10, Math.floor((width - 56) / 16)),
    ) *
      30.4 +
      40,
  );
}
