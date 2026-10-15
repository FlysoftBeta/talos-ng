import {
  AppError,
  ERROR_CODES,
  isUlid,
  readU32BE,
  utf8Decode,
  utf8Encode,
  writeU32BE,
} from "@talos/base";
import { DEFAULT_MAX_FRAME_BYTES, MAX_HEADER_BYTES } from "./protocol.ts";
import type { Frame, FrameInput } from "./protocol.ts";

export interface CodecOptions {
  maxFrameBytes?: number;
}
export function protocolError(): AppError {
  return new AppError("E_PROTOCOL", "通信协议错误");
}
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const str = (v: unknown): v is string => typeof v === "string";
const own = (v: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(v, key);
function validate(type: number, h: unknown): void {
  if (!object(h)) throw protocolError();
  let valid = false;
  switch (type) {
    case 1:
      valid =
        int(h.v) &&
        h.v > 0 &&
        str(h.build) &&
        (h.device === null || str(h.device)) &&
        h.lang === "zh-CN";
      break;
    case 2:
      valid =
        int(h.v) &&
        h.v > 0 &&
        str(h.build) &&
        int(h.now) &&
        str(h.device) &&
        str(h.conn) &&
        h.conn.length > 0;
      break;
    case 3:
      valid =
        int(h.id) &&
        str(h.m) &&
        h.m.length > 0 &&
        own(h, "a") &&
        (!own(h, "op") || (str(h.op) && isUlid(h.op)));
      break;
    case 4:
      valid =
        int(h.id) &&
        ((h.ok === true && own(h, "d")) ||
          (h.ok === false &&
            object(h.e) &&
            str(h.e.code) &&
            (ERROR_CODES as readonly string[]).includes(h.e.code) &&
            str(h.e.message)));
      break;
    case 5:
      valid = str(h.t) && h.t.length > 0 && own(h, "d");
      break;
    case 6:
    case 7:
      valid = int(h.n);
      break;
    case 8:
      valid = int(h.id);
      break;
    case 9:
      valid =
        str(h.code) &&
        (ERROR_CODES as readonly string[]).includes(h.code) &&
        (!own(h, "message") || str(h.message));
      break;
  }
  if (!valid) throw protocolError();
}
export function frameLimit(options: CodecOptions): number {
  const limit = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 7)
    throw new AppError("E_INVALID", "无效的帧大小限制");
  return limit;
}
export function encodeFrame(
  frame: FrameInput,
  options: CodecOptions = {},
): Uint8Array {
  const max = frameLimit(options);
  try {
    const json = JSON.stringify(frame.header);
    validate(frame.type, JSON.parse(json));
    const header = utf8Encode(json);
    const body = frame.body ?? new Uint8Array(0);
    if (
      !(body instanceof Uint8Array) ||
      header.length > MAX_HEADER_BYTES ||
      5 + header.length + body.length > max
    )
      throw protocolError();
    const bytes = new Uint8Array(5 + header.length + body.length);
    bytes[0] = frame.type;
    writeU32BE(bytes, header.length, 1);
    bytes.set(header, 5);
    bytes.set(body, 5 + header.length);
    return bytes;
  } catch {
    throw protocolError();
  }
}
export function decodeFrame(
  bytes: Uint8Array,
  options: CodecOptions = {},
): Frame {
  const max = frameLimit(options);
  try {
    if (bytes.length < 5 || bytes.length > max) throw protocolError();
    const length = readU32BE(bytes, 1);
    if (length > MAX_HEADER_BYTES || length > bytes.length - 5)
      throw protocolError();
    const header: unknown = JSON.parse(
      utf8Decode(bytes.subarray(5, 5 + length), true),
    );
    const type = bytes[0]!;
    validate(type, header);
    return { type, header, body: bytes.subarray(5 + length) } as Frame;
  } catch {
    throw protocolError();
  }
}
