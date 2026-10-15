import { AppError } from "@talos/base";
import { createHash } from "node:crypto";
import { guard } from "../errors.ts";
import type { ObjectInfo } from "../ports.ts";
import { validateChunk, validateSize } from "./validation.ts";

export const CHUNK_SIZE = 128 * 1024;
export async function* chunks(
  src: Uint8Array | AsyncIterable<Uint8Array>,
): AsyncIterable<Uint8Array> {
  if (src instanceof Uint8Array) {
    yield src;
    return;
  }
  if (!src || typeof src[Symbol.asyncIterator] !== "function")
    throw new AppError("E_INVALID", "Expected bytes or an async byte stream");
  for await (const chunk of src) {
    validateChunk(chunk);
    yield chunk;
  }
}
export async function hashStream(
  src: Uint8Array | AsyncIterable<Uint8Array>,
): Promise<ObjectInfo> {
  return guard(async () => {
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of chunks(src)) {
      size += chunk.byteLength;
      validateSize(size);
      hash.update(chunk);
    }
    return { id: hash.digest("hex"), size };
  });
}
