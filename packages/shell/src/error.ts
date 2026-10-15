/** Dependency-free AppError wire shape (architecture decision D-055). */
export type ShellErrorCode =
  | "E_INVALID"
  | "E_INTEGRITY"
  | "E_CANCELLED"
  | "E_BUSY"
  | "E_NOT_FOUND"
  | "E_CONFLICT"
  | "E_UNAVAILABLE"
  | "E_TOO_LARGE"
  | "E_INTERNAL";
export class ShellError extends Error {
  readonly code: ShellErrorCode;
  constructor(code: ShellErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
  toJSON(): { code: ShellErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}
export function shellError(error: unknown): ShellError {
  if (error instanceof ShellError) return error;
  return new ShellError(
    "E_UNAVAILABLE",
    error instanceof Error ? error.message : "应用资源暂时不可用",
  );
}
export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ShellError("E_CANCELLED", "下载已取消");
}
