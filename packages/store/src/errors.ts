import { AppError } from "@talos/base";

export function storageError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const e = error as { name?: string; message?: string } | null;
  const name = e?.name ?? "Error";
  const message = e?.message ?? String(error);
  switch (name) {
    case "QuotaExceededError":
      return new AppError("E_TOO_LARGE", message, { quota: true });
    case "TransactionInactiveError":
    case "InvalidStateError":
      return new AppError(
        "E_INVALID",
        "TransactionInactiveError: use synchronous IDB task chains inside a transaction",
        { name },
      );
    case "ConstraintError":
      return new AppError("E_CONFLICT", message, { name });
    case "VersionError":
      return new AppError("E_VERSION", message, { name });
    case "AbortError":
      return new AppError("E_CANCELLED", message, { name });
    case "DataError":
    case "DataCloneError":
    case "SyntaxError":
      return new AppError("E_INVALID", message, { name });
    case "NotFoundError":
      return new AppError("E_NOT_FOUND", message, { name });
    default:
      return new AppError("E_INTERNAL", message, { name });
  }
}
