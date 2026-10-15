import { conversionError } from "./errors.ts";
import { open, mkdir, mkdtemp, link } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@talos/base";
import type { PackSink } from "@talos/docpack";
import { FileSpool, removeTemp } from "../file-spool/files.ts";
import { checkAbort } from "./ports.ts";
import type {
  ConvertCtx,
  ConvertInput,
  Converter,
  ConvertSummary,
} from "./ports.ts";
export type ConvertDestination =
  | { objectSink: PackSink; filePath?: never }
  | { filePath: string; objectSink?: never };
export interface ConverterRegistry {
  detect(head: Uint8Array, name: string, mime?: string): Converter | undefined;
  convert(
    input: ConvertInput,
    destination: ConvertDestination,
    ctx: ConvertCtx,
  ): Promise<ConvertSummary>;
}
export function createConverterRegistry(
  converters: readonly Converter[],
): ConverterRegistry {
  const list = converters.slice();
  if (new Set(list.map((c) => c.id)).size !== list.length)
    throw new AppError("E_INVALID", "转换器标识重复");
  const detect = (
    head: Uint8Array,
    name: string,
    mime?: string,
  ): Converter | undefined =>
    list.find((c) => c.detect(head, "")) ??
    list.find((c) => c.detect(new Uint8Array(), name, mime));
  return {
    detect,
    convert: async (input, destination, ctx) => {
      let dir: string | undefined;
      let output: FileSpool | undefined;
      try {
        checkAbort(ctx.signal);
        const source = await open(input.path, "r");
        let head: Uint8Array;
        try {
          const b = Buffer.alloc(4096);
          const { bytesRead } = await source.read(b, 0, b.length, 0);
          head = b.subarray(0, bytesRead);
        } finally {
          await source.close();
        }
        const converter = detect(head, input.name, input.mime);
        if (!converter) throw new AppError("E_INVALID", "无法识别的文件格式");
        let sink = destination.objectSink;
        if (destination.filePath !== undefined) {
          const final = path.resolve(destination.filePath);
          await mkdir(path.dirname(final), { recursive: true });
          dir = await mkdtemp(path.join(path.dirname(final), ".docpipe-"));
          output = await FileSpool.create(path.join(dir, "pack"));
          sink = output;
        }
        if (!sink) throw new AppError("E_INVALID", "未指定文档输出位置");
        const summary = await converter.convert(input, sink, ctx);
        checkAbort(ctx.signal);
        if (output && dir && destination.filePath) {
          await output.sync();
          await output.close();
          output = undefined;
          await link(
            path.join(dir, "pack"),
            path.resolve(destination.filePath),
          );
        }
        return summary;
      } catch (error) {
        throw conversionError(error, ctx.signal);
      } finally {
        try {
          await output?.close();
        } finally {
          if (dir) await removeTemp(dir);
        }
      }
    },
  };
}
