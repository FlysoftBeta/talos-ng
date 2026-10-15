import { AppError } from "@talos/base";
import type { PackKind, PackSink } from "@talos/docpack";
export interface ConvertInput {
  path: string;
  name: string;
  mime?: string;
}
export interface ConvertCtx {
  signal: AbortSignal;
  progress(done: number, total: number): void;
  tmpDir: string;
  log(message: string, data?: Record<string, unknown>): void;
}
export interface ConvertSummary {
  kind: PackKind;
  units: number;
  title?: string;
  bytes: number;
  warnings: string[];
}
export interface Converter {
  id: string;
  detect(head: Uint8Array, name: string, mime?: string): boolean;
  convert(
    input: ConvertInput,
    sink: PackSink,
    ctx: ConvertCtx,
  ): Promise<ConvertSummary>;
}
export function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new AppError("E_CANCELLED", "文档转换已取消");
}
