import {
  appendFileSync,
  readFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface LoggerOptions {
  directory: string;
  build?: string;
  level?: LogLevel;
  maxBytes?: number;
  files?: number;
  now?: () => number;
  console?: (line: string) => void;
}
const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};
const sensitive =
  /pin|token|password|secret|authorization|cookie|private.?key/i;
function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const [key, item] of Object.entries(value))
      output[key] = sensitive.test(key)
        ? "[redacted]"
        : redact(item, depth + 1);
    return output;
  }
  return typeof value === "bigint" ? String(value) : value;
}
export class Logger {
  private readonly path: string;
  constructor(private readonly options: LoggerOptions) {
    mkdirSync(options.directory, { recursive: true });
    this.path = join(options.directory, "server.jsonl");
  }
  write(
    level: LogLevel,
    message: string,
    fields: Readonly<Record<string, unknown>> = {},
  ): void {
    if (levels[level] < levels[this.options.level ?? "info"]) return;
    const line =
      JSON.stringify({
        build: this.options.build ?? "unknown",
        time: (this.options.now ?? Date.now)(),
        level,
        message,
        fields: redact(fields),
      }) + "\n";
    let size = 0;
    try {
      size = statSync(this.path).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (
      size &&
      size + Buffer.byteLength(line) >
        (this.options.maxBytes ?? 5 * 1024 * 1024)
    )
      this.rotate();
    appendFileSync(this.path, line);
    (this.options.console ?? ((line) => process.stdout.write(line)))(line);
  }
  setBuild(build: string): void {
    this.options.build = build;
  }
  snapshot(): string {
    const lines: string[] = [];
    for (let i = this.options.files ?? 3; i >= 0; i--) {
      try {
        const body = readFileSync(i ? `${this.path}.${i}` : this.path, "utf8");
        for (const line of body.split("\n")) {
          try {
            if (
              (JSON.parse(line) as { build?: string }).build ===
              (this.options.build ?? "unknown")
            )
              lines.push(line);
          } catch {
            /* Ignore partial final line. */
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return lines.join("\n").slice(-5 * 1024 * 1024);
  }
  private rotate(): void {
    const count = this.options.files ?? 3;
    try {
      rmSync(`${this.path}.${count}`, {
        force: true,
        maxRetries: 3,
        retryDelay: 10,
      });
      for (let i = count - 1; i >= 1; i--)
        try {
          renameSync(`${this.path}.${i}`, `${this.path}.${i + 1}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      renameSync(this.path, `${this.path}.1`);
    } catch (error) {
      // Windows scanners can briefly hold an archive open; keep writing the
      // current file and retry rotation on the next log entry.
      if (
        !["EBUSY", "EPERM"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
    }
  }
}
