import { AppError } from "@talos/base";

export function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = errorCode(error);
  return new AppError(
    code === "ENOENT"
      ? "E_NOT_FOUND"
      : code === "EBUSY" || code === "EPERM"
        ? "E_BUSY"
        : code === "EACCES"
          ? "E_DENIED"
          : "E_INTERNAL",
    "Object store operation failed",
    { cause: code ?? "unknown" },
  );
}
export async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw asAppError(error);
  }
}
