import { AppError, sha256Hex } from "@talos/base";
import { deflateSync, inflateSync } from "fflate";
import { integer, isRid, MAX_RESOURCE_BYTES } from "./manifest.ts";
import type { Encoding } from "./manifest.ts";
export type Compressor = (bytes: Uint8Array) => Uint8Array;
export type Inflater = (bytes: Uint8Array, size: number) => Uint8Array;
export const defaultCompress: Compressor = (bytes) => deflateSync(bytes);
// A fixed output buffer prevents an untrusted frame from allocating a decompression bomb.
export const defaultInflate: Inflater = (bytes, size) =>
  inflateSync(bytes, { out: new Uint8Array(size + 1) });
export function decodeResource(
  enc: Encoding,
  stored: Uint8Array,
  expect: { rid: string; size: number },
  inflate: Inflater = defaultInflate,
): Uint8Array {
  try {
    if (
      !isRid(expect.rid) ||
      !integer(expect.size, MAX_RESOURCE_BYTES) ||
      stored.length > MAX_RESOURCE_BYTES ||
      (enc !== "raw" && enc !== "deflate")
    )
      throw new Error("metadata");
    const out = enc === "raw" ? stored.slice() : inflate(stored, expect.size);
    if (out.length !== expect.size || sha256Hex(out) !== expect.rid)
      throw new Error("hash or size");
    return out;
  } catch {
    throw new AppError("E_INTEGRITY", "文档资源校验失败", { rid: expect.rid });
  }
}
