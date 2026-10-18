export const ERROR_CODES = [
  "E_OFFLINE",
  "E_DISCONNECTED",
  "E_TIMEOUT",
  "E_CANCELLED",
  "E_PROTOCOL",
  "E_VERSION",
  "E_BUSY",
  "E_INVALID",
  "E_UNAUTHENTICATED",
  "E_DENIED",
  "E_NOT_FOUND",
  "E_CONFLICT",
  "E_RATE_LIMITED",
  "E_LOCKED",
  "E_UNAVAILABLE",
  "E_TOO_LARGE",
  "E_INTEGRITY",
  "E_INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export interface AppErrorJSON {
  code: ErrorCode;
  message: string;
  data?: unknown;
}
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly data?: unknown;
  constructor(code: ErrorCode, message: string, data?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.data = data;
  }
  /** Wraps a lower-level failure, passing its original message through as is. */
  static wrap(
    code: ErrorCode,
    message: string,
    cause: unknown,
    data?: unknown,
  ): AppError {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return new AppError(code, `${message}：${detail}`, data);
  }
  toJSON(): AppErrorJSON {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data };
  }
  static fromJSON(value: unknown): AppError {
    if (typeof value !== "object" || value === null)
      throw new TypeError("Invalid AppError JSON");
    const v = value as Record<string, unknown>;
    if (
      typeof v.code !== "string" ||
      !(ERROR_CODES as readonly string[]).includes(v.code) ||
      typeof v.message !== "string"
    )
      throw new TypeError("Invalid AppError JSON");
    return new AppError(v.code as ErrorCode, v.message, v.data);
  }
}
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
export function err<T = never>(error: AppError): Result<T> {
  return { ok: false, error };
}
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}
export function mapResult<T, U>(
  result: Result<T>,
  map: (value: T) => U,
): Result<U> {
  return result.ok ? ok(map(result.value)) : result;
}
