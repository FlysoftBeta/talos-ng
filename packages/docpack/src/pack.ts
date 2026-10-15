import {
  AppError,
  concat,
  readU32BE,
  sha256Hex,
  utf8Decode,
  utf8Encode,
  writeU32BE,
} from "@talos/base";
import { defaultCompress, decodeResource } from "./codec.ts";
import type { Compressor, Inflater } from "./codec.ts";
import {
  MAX_MANIFEST_BYTES,
  MAX_RESOURCES,
  MAX_RESOURCE_BYTES,
  invalid,
  validateManifest,
} from "./manifest.ts";
import type {
  ClientManifest,
  Manifest,
  OutlineEntry,
  PackKind,
  Unit,
} from "./manifest.ts";
import { readExact } from "./io.ts";
import type { PackSink, RandomAccess, Spool } from "./io.ts";
const MAGIC = utf8Encode("TDPACK1\n");
export interface PackWriterOptions {
  kind: PackKind;
  title?: string;
  meta?: Record<string, unknown>;
  compress?: Compressor;
}
export class PackWriter {
  private readonly value: Manifest;
  private done = false;
  private resourceCount = 0;
  private busy = false;
  constructor(
    private readonly sink: PackSink,
    private readonly spool: Spool,
    private readonly options: PackWriterOptions,
  ) {
    if (spool.size !== 0) invalid("spool must be empty");
    this.value = {
      v: 1,
      kind: options.kind,
      title: options.title,
      meta: options.meta ?? {},
      units: [],
      shared: [],
      resources: {},
    };
  }
  private writable(): void {
    if (this.done || this.busy)
      throw new AppError("E_CONFLICT", "文档包当前不可写入");
  }
  async addResource(bytes: Uint8Array, mime: string): Promise<string> {
    this.writable();
    if (bytes.length > MAX_RESOURCE_BYTES)
      throw new AppError("E_TOO_LARGE", "文档资源过大");
    const rid = sha256Hex(bytes);
    if (this.value.resources[rid]) return rid;
    if (this.resourceCount >= MAX_RESOURCES)
      throw new AppError("E_TOO_LARGE", "文档资源过多");
    if (!mime || mime.length > 255) invalid("mime");
    this.busy = true;
    try {
      let stored = bytes;
      let enc: "raw" | "deflate" = "raw";
      if (
        /^(text\/|application\/(?:json|javascript|xml|xhtml\+xml)|image\/svg\+xml)/i.test(
          mime,
        ) &&
        bytes.length
      ) {
        const compressed = (this.options.compress ?? defaultCompress)(bytes);
        if (compressed.length <= bytes.length * 0.9) {
          stored = compressed;
          enc = "deflate";
        }
      }
      const offset = this.spool.size;
      await this.spool.append(stored);
      this.value.resources[rid] = {
        mime,
        enc,
        size: bytes.length,
        stored: stored.length,
        offset,
      };
      this.resourceCount++;
      return rid;
    } catch (error) {
      this.done = true;
      throw error;
    } finally {
      this.busy = false;
    }
  }
  addUnit(unit: Omit<Unit, "ordinal">): void {
    this.writable();
    this.value.units.push({
      ...unit,
      deps: unit.deps.slice(),
      ordinal: this.value.units.length,
    });
  }
  setShared(rids: readonly string[]): void {
    this.writable();
    this.value.shared = rids.slice();
  }
  setOutline(outline: readonly OutlineEntry[]): void {
    this.writable();
    this.value.outline = outline.map((o) => ({ ...o }));
  }
  async finish(): Promise<Manifest> {
    this.writable();
    this.done = true;
    validateManifest(this.value, this.spool.size);
    let manifest: Uint8Array;
    try {
      manifest = utf8Encode(JSON.stringify(this.value));
    } catch {
      invalid("JSON metadata");
    }
    if (manifest.length > MAX_MANIFEST_BYTES)
      throw new AppError("E_TOO_LARGE", "文档索引过大");
    const header = new Uint8Array(12);
    header.set(MAGIC);
    writeU32BE(header, manifest.length, 8);
    await this.sink.write(concat(header, manifest));
    for (let offset = 0; offset < this.spool.size; offset += 64 * 1024)
      await this.sink.write(
        await readExact(
          this.spool,
          offset,
          Math.min(64 * 1024, this.spool.size - offset),
        ),
      );
    return JSON.parse(utf8Decode(manifest)) as Manifest;
  }
}
export class PackReader {
  private value: Manifest | undefined;
  private start = 0;
  constructor(
    private readonly source: RandomAccess,
    private readonly inflate?: Inflater,
  ) {}
  static async open(
    source: RandomAccess,
    inflate?: Inflater,
  ): Promise<PackReader> {
    const reader = new PackReader(source, inflate);
    await reader.open();
    return reader;
  }
  async open(): Promise<this> {
    const head = await readExact(this.source, 0, 12);
    if (!MAGIC.every((b, i) => head[i] === b)) invalid("magic");
    const length = readU32BE(head, 8);
    if (length > MAX_MANIFEST_BYTES)
      throw new AppError("E_TOO_LARGE", "文档索引过大");
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        utf8Decode(await readExact(this.source, 12, length), true),
      );
    } catch {
      invalid("manifest JSON");
    }
    this.start = 12 + length;
    this.value = validateManifest(parsed, this.source.size - this.start);
    return this;
  }
  get manifest(): Manifest {
    if (!this.value) throw new AppError("E_CONFLICT", "文档包尚未打开");
    return JSON.parse(JSON.stringify(this.value)) as Manifest;
  }
  clientManifest(): ClientManifest {
    const m = this.manifest;
    const resources: ClientManifest["resources"] = {};
    for (const rid of Object.keys(m.resources)) {
      const r = m.resources[rid]!;
      resources[rid] = {
        mime: r.mime,
        enc: r.enc,
        size: r.size,
        stored: r.stored,
      };
    }
    return { ...m, resources };
  }
  private resource(rid: string) {
    if (!this.value) throw new AppError("E_CONFLICT", "文档包尚未打开");
    const r = this.value.resources[rid];
    if (!r || !Object.prototype.hasOwnProperty.call(this.value.resources, rid))
      throw new AppError("E_NOT_FOUND", "文档资源不存在", { rid });
    return r;
  }
  async readStored(rid: string): Promise<Uint8Array> {
    const r = this.resource(rid);
    return readExact(this.source, this.start + r.offset, r.stored);
  }
  async readDecoded(rid: string): Promise<Uint8Array> {
    const r = this.resource(rid);
    return decodeResource(
      r.enc,
      await this.readStored(rid),
      { rid, size: r.size },
      this.inflate,
    );
  }
}
