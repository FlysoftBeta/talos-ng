import { AppError, utf8Encode } from "@talos/base";
import type { BodyChunk } from "../options.ts";
export function textChunk(
  text: string,
  args: { offset: number; limit?: number },
): BodyChunk {
  const bytes = utf8Encode(text);
  if (args.offset > bytes.length)
    throw new AppError("E_INVALID", "读取位置超出文本");
  const end = Math.min(bytes.length, args.offset + (args.limit ?? 512 * 1024));
  return {
    data: {
      size: bytes.length,
      offset: args.offset,
      eof: end === bytes.length,
    },
    body: bytes.slice(args.offset, end),
  };
}
