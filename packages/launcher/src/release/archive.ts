import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { AppError } from "@talos/base";
export const MAX_ARCHIVE = 512 * 1024 * 1024;
export const MAX_EXPANDED = 1024 * 1024 * 1024;
export function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function safePath(name: string): void {
  if (
    typeof name !== "string" ||
    !name ||
    name.length > 240 ||
    /[\\:*?"<>|\x00-\x1f]/.test(name) ||
    name.startsWith("/") ||
    name
      .split("/")
      .some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
      )
  )
    throw new AppError("E_INVALID", "压缩包路径无效");
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** ZIP32, bounded before inflation; no links, encryption, ambiguous paths or duplicate names. */
export function readZip(input: Uint8Array): Map<string, Buffer> {
  if (input.length > MAX_ARCHIVE || input.length < 22)
    throw new AppError("E_TOO_LARGE", "压缩包大小无效");
  const bytes = Buffer.from(input);
  try {
    let end = bytes.length - 22;
    while (
      end >= Math.max(0, bytes.length - 65557) &&
      bytes.readUInt32LE(end) !== 0x06054b50
    )
      end--;
    if (
      end < 0 ||
      bytes.readUInt16LE(end + 4) ||
      bytes.readUInt16LE(end + 6) ||
      end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length
    )
      throw new Error();
    const count = bytes.readUInt16LE(end + 10);
    let pos = bytes.readUInt32LE(end + 16);
    if (
      count === 65535 ||
      count !== bytes.readUInt16LE(end + 8) ||
      pos + bytes.readUInt32LE(end + 12) !== end
    )
      throw new Error();
    const central = pos;
    const entries: {
      name: string;
      start: number;
      size: number;
      packed: number;
      crc: number;
      method: number;
    }[] = [];
    const names = new Set<string>();
    let total = 0;
    let priorEnd = 0;
    for (let i = 0; i < count; i++) {
      if (bytes.readUInt32LE(pos) !== 0x02014b50) throw new Error();
      const flags = bytes.readUInt16LE(pos + 8),
        method = bytes.readUInt16LE(pos + 10);
      const packed = bytes.readUInt32LE(pos + 20),
        size = bytes.readUInt32LE(pos + 24);
      const len = bytes.readUInt16LE(pos + 28),
        extra = bytes.readUInt16LE(pos + 30),
        comment = bytes.readUInt16LE(pos + 32);
      const offset = bytes.readUInt32LE(pos + 42);
      const rawName = bytes.subarray(pos + 46, pos + 46 + len).toString("utf8");
      const dir = rawName.endsWith("/");
      const name = dir ? rawName.slice(0, -1) : rawName;
      safePath(name);
      const mode = bytes.readUInt32LE(pos + 38) >>> 16;
      if (
        flags & 1 ||
        ![0, 8].includes(method) ||
        (mode & 0xf000) === 0xa000 ||
        names.has(name.toLowerCase())
      )
        throw new Error();
      names.add(name.toLowerCase());
      total += size;
      if (total > MAX_EXPANDED || size > MAX_ARCHIVE)
        throw new AppError("E_TOO_LARGE", "压缩包展开后过大");
      if (
        offset < priorEnd ||
        bytes.readUInt32LE(offset) !== 0x04034b50 ||
        bytes.readUInt16LE(offset + 8) !== method
      )
        throw new Error();
      const localLen = bytes.readUInt16LE(offset + 26),
        localExtra = bytes.readUInt16LE(offset + 28);
      if (
        bytes.subarray(offset + 30, offset + 30 + localLen).toString("utf8") !==
        rawName
      )
        throw new Error();
      const start = offset + 30 + localLen + localExtra;
      if (start + packed > central) throw new Error();
      priorEnd = start + packed;
      if (!dir)
        entries.push({
          name,
          start,
          size,
          packed,
          method,
          crc: bytes.readUInt32LE(pos + 16),
        });
      pos += 46 + len + extra + comment;
    }
    if (pos !== end) throw new Error();
    const fileNames = new Set(entries.map((entry) => entry.name.toLowerCase()));
    for (const entry of entries) {
      const parts = entry.name.toLowerCase().split("/");
      for (let i = 1; i < parts.length; i++)
        if (fileNames.has(parts.slice(0, i).join("/")))
          throw new AppError("E_INVALID", "压缩包文件与目录冲突");
    }
    const result = new Map<string, Buffer>();
    for (const e of entries) {
      const packed = bytes.subarray(e.start, e.start + e.packed);
      const data =
        e.method === 0
          ? packed
          : inflateRawSync(packed, { maxOutputLength: Math.max(1, e.size) });
      if (data.length !== e.size || crc32(data) !== e.crc) throw new Error();
      result.set(e.name, data);
    }
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("E_INTEGRITY", "压缩包损坏或格式不支持");
  }
}
export function writeZip(files: ReadonlyMap<string, Uint8Array>): Buffer {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  const names = new Set<string>();
  for (const [name, data] of files) {
    safePath(name);
    if (names.has(name.toLowerCase()))
      throw new AppError("E_INVALID", "文件名重复");
    names.add(name.toLowerCase());
    const n = Buffer.from(name),
      crc = crc32(data),
      h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x800, 6);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(n.length, 26);
    local.push(h, n, Buffer.from(data));
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += h.length + n.length + data.length;
  }
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22);
  if (files.size >= 65535 || offset + cd.length + 22 > MAX_ARCHIVE)
    throw new AppError("E_TOO_LARGE", "压缩包过大");
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
