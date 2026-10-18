import { AppError } from "./errors.ts";

/** Diagnostics never carry exception messages, arguments, URL queries or credentials. */
export function diagnosticText(value: string, limit = 2048): string {
  return (
    value
      .slice(0, limit)
      .replace(/(https?:\/\/[^\s?#]+)[?#][^\s)]*/gi, "$1?[redacted]")
      .replace(
        /\b(pin|token|password|secret|authorization|cookie)\b\s*[:=]?\s*["']?[^\s,;"')]+/gi,
        "$1=[redacted]",
      )
      // Keeps the :line:col of stack frames, which a minified bundle makes six digits long.
      .replace(/(?<!:)\b\d{6}\b/g, "[redacted]")
      .replace(/\b[a-zA-Z0-9_-]{32,}\b/g, "[redacted]")
      .slice(0, limit)
  );
}
export function diagnosticError(error: unknown): {
  name: string;
  stack: string;
} {
  // The closed error-code enum is safe to keep; the message is not.
  const code = error instanceof AppError ? `[${error.code}]` : "";
  const name =
    error instanceof Error &&
    /^(Error|TypeError|RangeError|ReferenceError|SyntaxError|URIError|EvalError|AppError)$/.test(
      error.name,
    )
      ? `${error.name}${code}`
      : "Error";
  const stack =
    error instanceof Error
      ? (error.stack ?? "")
          .split("\n")
          .slice(1, 9)
          .filter((line) => /^\s*at\s/.test(line))
          .join("\n")
      : "";
  return { name, stack: diagnosticText(stack) };
}
