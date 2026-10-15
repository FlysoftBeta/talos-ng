import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { mkdtemp, mkdir } from "node:fs/promises";
import path from "node:path";
import { AppError, Semaphore } from "@talos/base";
import type { PdfRenderLocation } from "./resolve.ts";
import { removeTemp } from "../file-spool/files.ts";
import { checkAbort } from "../conversion/ports.ts";
export interface RunnerTimer {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
export interface PdfRenderRunnerOptions {
  location: PdfRenderLocation;
  concurrency?: number;
  timeoutMs?: number;
  cpus?: number;
  timer?: RunnerTimer;
  /** Used for portable fake renderer scripts in tests. */ prefixArgs?: readonly string[];
}
const timers: RunnerTimer = {
  set: (cb, ms) => setTimeout(cb, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};
export class PdfRenderRunner {
  private readonly slots: Semaphore;
  private readonly timer: RunnerTimer;
  private readonly timeout: number;
  constructor(private readonly options: PdfRenderRunnerOptions) {
    if (
      !Number.isSafeInteger(options.concurrency ?? 2) ||
      (options.concurrency ?? 2) < 1
    )
      throw new AppError("E_INVALID", "无效的渲染器并发配置");
    this.slots = new Semaphore(options.concurrency ?? 2);
    this.timer = options.timer ?? timers;
    this.timeout = options.timeoutMs ?? 30 * 60 * 1000;
    if (
      !Number.isFinite(this.timeout) ||
      this.timeout <= 0 ||
      this.timeout > 2147483647 ||
      (options.cpus !== undefined &&
        (!Number.isFinite(options.cpus) || options.cpus <= 0))
    )
      throw new AppError("E_INVALID", "无效的渲染器配置");
  }
  /** The archive path is scoped to consume(); it is removed even if consumption fails. */
  async run<T>(
    input: string,
    tmpDir: string,
    signal: AbortSignal,
    consume: (archive: string) => Promise<T>,
  ): Promise<T> {
    return this.slots.run(async () => {
      checkAbort(signal);
      await mkdir(tmpDir, { recursive: true });
      const dir = await mkdtemp(path.join(path.resolve(tmpDir), "pdfrender-"));
      try {
        checkAbort(signal);
        const out = path.join(dir, "render.zip");
        await this.execute(path.resolve(input), out, dir, signal);
        checkAbort(signal);
        return await consume(out);
      } finally {
        await removeTemp(dir);
      }
    }, signal);
  }
  private execute(
    input: string,
    output: string,
    cwd: string,
    signal: AbortSignal,
  ): Promise<void> {
    const { location } = this.options;
    const jobs = Math.max(
      1,
      Math.min(4, Math.ceil((this.options.cpus ?? availableParallelism()) / 2)),
    );
    const args = [
      ...(this.options.prefixArgs ?? []),
      "--resolution",
      "96",
      "--webp-quality",
      "80",
      "--jobs",
      String(jobs),
      input,
      output,
    ];
    return new Promise((resolve, reject) => {
      const child = spawn(location.executable, args, {
        cwd,
        env: location.env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let tail = Buffer.alloc(0);
      let timer: unknown;
      let reason: AppError | undefined;
      let spawnError: Error | undefined;
      const kill = (): void => {
        if (location.platform === "win32" && child.pid) {
          const killer = spawn(
            "taskkill",
            ["/PID", String(child.pid), "/T", "/F"],
            { shell: false, windowsHide: true, stdio: "ignore" },
          );
          killer.once("error", () => child.kill("SIGKILL"));
          killer.once("exit", (code) => {
            if (code !== 0) child.kill("SIGKILL");
          });
        } else child.kill("SIGKILL");
      };
      const abort = (): void => {
        if (!reason) reason = new AppError("E_CANCELLED", "文档转换已取消");
        kill();
      };
      signal.addEventListener("abort", abort, { once: true });
      child.stderr.on("data", (chunk: Buffer) => {
        tail = Buffer.from(
          Buffer.concat([tail, chunk.subarray(-64 * 1024)]).subarray(
            -64 * 1024,
          ),
        );
      });
      child.once("spawn", () => {
        if (signal.aborted) {
          abort();
          return;
        }
        timer = this.timer.set(() => {
          if (!reason) reason = new AppError("E_TIMEOUT", "文档渲染超时");
          kill();
        }, this.timeout);
      });
      child.once("error", (error) => {
        spawnError = error;
      });
      child.once("close", (code, exitSignal) => {
        if (timer !== undefined) this.timer.clear(timer);
        signal.removeEventListener("abort", abort);
        const data = {
          exitCode: code,
          signal: exitSignal,
          stderr: tail.toString("utf8"),
          cause: spawnError?.message,
        };
        if (reason) reject(new AppError(reason.code, reason.message, data));
        else if (spawnError)
          reject(new AppError("E_UNAVAILABLE", "无法启动文档渲染器", data));
        else if (code === 0) resolve();
        else if (code === 1)
          reject(
            new AppError(
              "E_INVALID",
              /encrypt|password/i.test(data.stderr)
                ? "文档已加密，暂不支持"
                : "文档无效、已加密或没有页面",
              data,
            ),
          );
        else
          reject(
            new AppError(
              code === 2 ? "E_INTERNAL" : "E_INVALID",
              "文档渲染失败",
              data,
            ),
          );
      });
      if (signal.aborted) abort();
    });
  }
}
