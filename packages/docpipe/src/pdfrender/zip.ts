import { AppError, utf8Decode } from "@talos/base";
import {
  readExact,
  MAX_RESOURCE_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_RESOURCES,
} from "@talos/docpack";
import type { RandomAccess } from "@talos/docpack";
export interface ZipEntry {
  name: string;
  offset: number;
  size: number;
  crc: number;
}
export function archiveError(detail: string): never {
  throw new AppError("E_INTEGRITY", "文档渲染归档无效", { detail });
}
function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function u64(v: DataView, at: number): number {
  const n = v.getUint32(at, true) + v.getUint32(at + 4, true) * 4294967296;
  if (!Number.isSafeInteger(n)) archiveError("unsafe ZIP64 integer");
  return n;
}
function extended(bytes: Uint8Array, values: number[]): number[] {
  const v = view(bytes);
  let at = 0;
  let found = false;
  while (at < bytes.length) {
    if (at + 4 > bytes.length) archiveError("extra header");
    const id = v.getUint16(at, true),
      len = v.getUint16(at + 2, true);
    at += 4;
    if (at + len > bytes.length) archiveError("extra length");
    if (id === 1) {
      if (found) archiveError("duplicate ZIP64 field");
      found = true;
      let p = at;
      values = values.map((n) => {
        if (n !== 0xffffffff) return n;
        if (p + 8 > at + len) archiveError("ZIP64 length");
        const result = u64(v, p);
        p += 8;
        return result;
      });
    }
    at += len;
  }
  if (values.includes(0xffffffff)) archiveError("missing ZIP64 field");
  return values;
}
/** Central-directory driven, with every local header cross-checked and no unindexed bytes. */
export async function indexZip(
  source: RandomAccess,
): Promise<Map<string, ZipEntry>> {
  try {
    return await parseZip(source);
  } catch (error) {
    if (error instanceof AppError) throw error;
    archiveError(String(error));
  }
}
async function parseZip(source: RandomAccess): Promise<Map<string, ZipEntry>> {
  const tail = await readExact(
    source,
    Math.max(0, source.size - 65557),
    Math.min(source.size, 65557),
  );
  const v = view(tail);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--)
    if (
      v.getUint32(i, true) === 0x06054b50 &&
      i + 22 + v.getUint16(i + 20, true) === tail.length
    ) {
      end = i;
      break;
    }
  if (end < 0) archiveError("EOCD missing");
  if (
    v.getUint16(end + 4, true) !== 0 ||
    v.getUint16(end + 6, true) !== 0 ||
    v.getUint16(end + 8, true) !== v.getUint16(end + 10, true)
  )
    archiveError("multi-disk ZIP");
  let count = v.getUint16(end + 10, true),
    size = v.getUint32(end + 12, true),
    offset = v.getUint32(end + 16, true);
  let directoryEnd = source.size - tail.length + end;
  if (count === 65535 || size === 0xffffffff || offset === 0xffffffff) {
    const loc = view(await readExact(source, directoryEnd - 20, 20));
    if (
      loc.getUint32(0, true) !== 0x07064b50 ||
      loc.getUint32(4, true) !== 0 ||
      loc.getUint32(16, true) !== 1
    )
      archiveError("ZIP64 locator");
    const pos = u64(loc, 8),
      z = view(await readExact(source, pos, 56));
    if (
      z.getUint32(0, true) !== 0x06064b50 ||
      u64(z, 4) !== 44 ||
      pos + 56 !== directoryEnd - 20 ||
      z.getUint32(16, true) !== 0 ||
      z.getUint32(20, true) !== 0 ||
      u64(z, 24) !== u64(z, 32)
    )
      archiveError("ZIP64 end");
    const n = u64(z, 32),
      s = u64(z, 40),
      o = u64(z, 48);
    if (
      (count !== 65535 && count !== n) ||
      (size !== 0xffffffff && size !== s) ||
      (offset !== 0xffffffff && offset !== o)
    )
      archiveError("inconsistent end records");
    count = n;
    size = s;
    offset = o;
    directoryEnd = pos;
  }
  if (count > MAX_RESOURCES + 2 || offset + size !== directoryEnd)
    archiveError("directory bounds");
  const entries = new Map<string, ZipEntry>();
  const ranges: { start: number; end: number }[] = [];
  let cursor = offset;
  for (let i = 0; i < count; i++) {
    const h = view(await readExact(source, cursor, 46));
    if (h.getUint32(0, true) !== 0x02014b50) archiveError("central header");
    const flags = h.getUint16(8, true);
    if (
      (flags !== 0 && flags !== 0x800) ||
      h.getUint16(10, true) !== 0 ||
      h.getUint16(34, true) !== 0
    )
      archiveError("STORED, unencrypted entries only");
    const nl = h.getUint16(28, true),
      el = h.getUint16(30, true),
      cl = h.getUint16(32, true);
    const variable = await readExact(source, cursor + 46, nl + el + cl);
    const name = utf8Decode(variable.subarray(0, nl), true);
    if (
      !/^(manifest\.json|dictionary\.zdict|objects\/[0-9a-f]{64}(?:\.zst)?)$/.test(
        name,
      ) ||
      entries.has(name)
    )
      archiveError("entry name");
    const [raw, stored, local] = extended(variable.subarray(nl, nl + el), [
      h.getUint32(24, true),
      h.getUint32(20, true),
      h.getUint32(42, true),
    ]) as [number, number, number];
    if (
      raw !== stored ||
      stored >
        (name === "manifest.json" ? MAX_MANIFEST_BYTES : MAX_RESOURCE_BYTES)
    )
      archiveError("entry size");
    const l = view(await readExact(source, local, 30));
    if (
      l.getUint32(0, true) !== 0x04034b50 ||
      l.getUint16(6, true) !== flags ||
      l.getUint16(8, true) !== 0 ||
      l.getUint32(14, true) !== h.getUint32(16, true)
    )
      archiveError("local header");
    const ln = l.getUint16(26, true),
      le = l.getUint16(28, true);
    const lv = await readExact(source, local + 30, ln + le);
    const [lr, ls] = extended(lv.subarray(ln), [
      l.getUint32(22, true),
      l.getUint32(18, true),
    ]);
    if (
      utf8Decode(lv.subarray(0, ln), true) !== name ||
      lr !== raw ||
      ls !== stored
    )
      archiveError("local mismatch");
    const data = local + 30 + ln + le;
    if (data + stored > offset) archiveError("payload bounds");
    entries.set(name, {
      name,
      offset: data,
      size: stored,
      crc: h.getUint32(16, true),
    });
    ranges.push({ start: local, end: data + stored });
    cursor += 46 + nl + el + cl;
    if (cursor > directoryEnd) archiveError("directory overflow");
  }
  if (cursor !== directoryEnd) archiveError("directory size");
  ranges.sort((a, b) => a.start - b.start);
  let at = 0;
  for (const r of ranges) {
    if (r.start !== at) archiveError("overlapping or unindexed local entry");
    at = r.end;
  }
  if (at !== offset || !entries.has("manifest.json"))
    archiveError("missing manifest or unindexed bytes");
  return entries;
}
