import { crc32, zstdDecompressSync } from "node:zlib";
import { AppError, sha256Hex, utf8Decode } from "@talos/base";
import { readExact } from "@talos/docpack";
import type { RandomAccess } from "@talos/docpack";
import { archiveError, indexZip } from "./zip.ts";
import type { ZipEntry } from "./zip.ts";
import { validateArchiveManifest } from "./archive-manifest.ts";
import type { ArchiveManifest, ArchiveResource } from "./archive-manifest.ts";
export class PdfRenderArchive {
  private readonly resources: Map<string, ArchiveResource>;
  private constructor(
    private readonly source: RandomAccess,
    private readonly value: ArchiveManifest,
    private readonly entries: Map<string, ZipEntry>,
    private readonly dictionary?: Uint8Array,
  ) {
    this.resources = new Map(value.resources.map((r) => [r.contentId, r]));
  }
  get manifest(): ArchiveManifest {
    return JSON.parse(JSON.stringify(this.value)) as ArchiveManifest;
  }
  static async open(source: RandomAccess): Promise<PdfRenderArchive> {
    const entries = await indexZip(source);
    const e = entries.get("manifest.json")!;
    const bytes = await readExact(source, e.offset, e.size);
    if (crc32(bytes) !== e.crc) archiveError("manifest CRC");
    let value: unknown;
    try {
      value = JSON.parse(utf8Decode(bytes, true));
    } catch {
      archiveError("manifest JSON");
    }
    const manifest = validateArchiveManifest(value, entries);
    let dictionary: Uint8Array | undefined;
    if (manifest.dictionary) {
      const d = manifest.dictionary;
      dictionary = await readExact(source, d.storedOffset, d.size);
      if (
        sha256Hex(dictionary) !== d.contentId ||
        crc32(dictionary) !== entries.get(d.path)!.crc
      )
        archiveError("dictionary hash");
    }
    return new PdfRenderArchive(source, manifest, entries, dictionary);
  }
  async readDecoded(rid: string): Promise<Uint8Array> {
    const r = this.resources.get(rid);
    if (!r) throw new AppError("E_NOT_FOUND", "文档资源不存在", { rid });
    try {
      const stored = await readExact(this.source, r.storedOffset, r.storedSize);
      if (crc32(stored) !== this.entries.get(r.path)!.crc)
        archiveError("resource CRC");
      const raw =
        r.encoding === "identity"
          ? stored
          : zstdDecompressSync(stored, {
              dictionary:
                r.encoding === "zstd-dictionary" ? this.dictionary : undefined,
              maxOutputLength: Math.max(1, r.rawSize),
            });
      if (raw.length !== r.rawSize || sha256Hex(raw) !== rid)
        archiveError("resource hash or raw size");
      return raw;
    } catch (error) {
      throw new AppError("E_INTEGRITY", "文档资源校验失败", {
        rid,
        cause: String(error),
      });
    }
  }
}
