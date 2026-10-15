import { AppError } from "@talos/base";
import type { Converter } from "./ports.ts";
/** Keep OS paths and implementation messages in diagnostics, not user copy. */
export function conversionError(error: unknown, signal: AbortSignal): AppError {
  if (error instanceof AppError) return error;
  if (signal.aborted) return new AppError("E_CANCELLED", "文档转换已取消");
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  return new AppError(
    code === "ENOENT"
      ? "E_NOT_FOUND"
      : code === "EEXIST"
        ? "E_CONFLICT"
        : "E_INTERNAL",
    code === "ENOENT"
      ? "文档不存在"
      : code === "EEXIST"
        ? "输出文件已存在"
        : "文档转换失败",
    { cause: String(error) },
  );
}
export function guardConverter(converter: Converter): Converter {
  return {
    ...converter,
    convert: async (input, sink, ctx) => {
      try {
        return await converter.convert(input, sink, ctx);
      } catch (error) {
        throw conversionError(error, ctx.signal);
      }
    },
  };
}
