import { AppError, fromHex, toHex, readU32BE, writeU32BE } from "@talos/base";
import { isRid, MAX_RESOURCE_BYTES, MAX_RESOURCES } from "./manifest.ts";
import type { Encoding } from "./manifest.ts";
export interface ResourceRecord {
  rid: string;
  enc: Encoding;
  bytes: Uint8Array;
}
function bad(): never {
  throw new AppError("E_PROTOCOL", "文档资源传输格式无效");
}
/** Repeated [u32 BE record length, 32-byte hash, u8 encoding, payload]. */
export function encodeResourceBatch(
  records: readonly ResourceRecord[],
): Uint8Array {
  if (records.length > MAX_RESOURCES) bad();
  let size = 0;
  for (const r of records) {
    if (
      !isRid(r.rid) ||
      (r.enc !== "raw" && r.enc !== "deflate") ||
      r.bytes.length > MAX_RESOURCE_BYTES
    )
      bad();
    size += 37 + r.bytes.length;
  }
  if (!Number.isSafeInteger(size) || size > MAX_RESOURCE_BYTES) bad();
  const out = new Uint8Array(size);
  let at = 0;
  for (const r of records) {
    writeU32BE(out, 33 + r.bytes.length, at);
    out.set(fromHex(r.rid), at + 4);
    out[at + 36] = r.enc === "raw" ? 0 : 1;
    out.set(r.bytes, at + 37);
    at += 37 + r.bytes.length;
  }
  return out;
}
export function decodeResourceBatch(bytes: Uint8Array): ResourceRecord[] {
  if (bytes.length > MAX_RESOURCE_BYTES) bad();
  const result: ResourceRecord[] = [];
  let at = 0;
  while (at < bytes.length) {
    if (bytes.length - at < 37 || result.length >= MAX_RESOURCES) bad();
    const len = readU32BE(bytes, at);
    if (len < 33 || len > bytes.length - at - 4) bad();
    const enc = bytes[at + 36];
    if (enc !== 0 && enc !== 1) bad();
    result.push({
      rid: toHex(bytes.subarray(at + 4, at + 36)),
      enc: enc === 0 ? "raw" : "deflate",
      bytes: bytes.slice(at + 37, at + 4 + len),
    });
    at += 4 + len;
  }
  return result;
}
