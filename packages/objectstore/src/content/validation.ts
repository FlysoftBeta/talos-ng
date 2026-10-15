import { AppError } from "@talos/base";
import { validateId } from "./identity.ts";
import type { ByteRange, ObjectInfo } from "../ports.ts";

export function validateSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0)
    throw new AppError("E_INVALID", "Expected a nonnegative safe integer");
}
export function validateExpect(expect?: Partial<ObjectInfo>): void {
  if (expect?.id !== undefined) validateId(expect.id);
  if (expect?.size !== undefined) validateSize(expect.size);
}
export function checkExpect(
  info: ObjectInfo,
  expect?: Partial<ObjectInfo>,
): void {
  if (
    (expect?.id !== undefined && expect.id !== info.id) ||
    (expect?.size !== undefined && expect.size !== info.size)
  )
    throw new AppError("E_INTEGRITY", "Object hash or size mismatch", {
      actual: info,
      expected: expect,
    });
}
export function checkedRange(size: number, range?: ByteRange): ByteRange {
  const value = range ?? { start: 0, end: size };
  validateSize(value.start);
  validateSize(value.end);
  if (value.start > value.end || value.end > size)
    throw new AppError("E_INVALID", "Range outside object bounds", { size });
  return { ...value };
}
export function validateChunk(chunk: Uint8Array): void {
  if (!(chunk instanceof Uint8Array))
    throw new AppError("E_INVALID", "Expected bytes");
}
