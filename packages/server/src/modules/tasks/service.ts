import { AppError } from "@talos/base";
import type { Jobs, JobTimers } from "../../kernel/jobs/jobs.ts";
import { TasksRepo } from "./repo.ts";

export class TasksService {
  readonly repo: TasksRepo;
  constructor(private readonly jobs: Jobs) {
    this.repo = new TasksRepo(jobs);
  }
  retry(owner: string, id: string): void {
    this.jobs.retry(owner, id);
  }
  cancel(owner: string, id: string): void {
    this.jobs.cancel(owner, id);
  }
  clear(owner: string, id?: string): void {
    if (id !== undefined) {
      this.jobs.clear(owner, id);
      return;
    }
    const history = this.repo
      .owned(owner)
      .filter(
        (job) =>
          !job.deleted && job.state !== "queued" && job.state !== "running",
      )
      .sort((a, b) => b.created - a.created || b.id.localeCompare(a.id));
    for (const job of history.slice(100)) this.jobs.clear(owner, job.id);
  }
}

/** Dev-only kind, with all waits injected for deterministic integration tests. */
export function registerDebugSleep(jobs: Jobs, timers: JobTimers): void {
  jobs.register("debug.sleep", {
    concurrency: 2,
    timeoutMs: 60_000,
    onBoot: "requeue",
    retryable: true,
    run: (context) => {
      const payload = context.payload as {
        ms?: unknown;
        steps?: unknown;
      } | null;
      const ms = payload?.ms ?? 1000;
      const steps = payload?.steps ?? 10;
      if (
        typeof ms !== "number" ||
        !Number.isSafeInteger(ms) ||
        ms < 0 ||
        ms > 30_000 ||
        typeof steps !== "number" ||
        !Number.isSafeInteger(steps) ||
        steps < 1 ||
        steps > 100
      ) {
        throw new AppError("E_INVALID", "调试任务参数无效");
      }
      return new Promise<unknown>((resolve, reject) => {
        let timer: unknown;
        let completed = 0;
        const cancel = (): void => {
          timers.clearTimeout(timer);
          context.signal.removeEventListener("abort", cancel);
          reject(new AppError("E_CANCELLED", "任务已取消"));
        };
        const tick = (): void => {
          completed++;
          context.progress(completed / steps, `${completed}/${steps}`);
          if (completed === steps) {
            context.signal.removeEventListener("abort", cancel);
            resolve({ sleptMs: ms });
          } else timer = timers.setTimeout(tick, ms / steps);
        };
        context.signal.addEventListener("abort", cancel);
        if (context.signal.aborted) {
          cancel();
          return;
        }
        timer = timers.setTimeout(tick, ms / steps);
      });
    },
  });
}
