import { AppError } from "@talos/base";
import { migrate } from "../persistence/db.ts";
import { jobsMigrations } from "./jobs-schema.ts";
import { JobRepo } from "./jobs-repo.ts";
import type { Job, JobKind, JobsOptions, JobTimers } from "./jobs-types.ts";
export type {
  Job,
  JobState,
  JobContext,
  JobKind,
  JobsOptions,
  JobTimers,
} from "./jobs-types.ts";
export { JOBS_SCHEMA, jobsMigrations } from "./jobs-schema.ts";

interface Running {
  owner: string;
  completion?: Promise<void>;
  started: number;
  controller: AbortController;
  timeout?: unknown;
  progressTimer?: unknown;
  pending?: { value: number; message: string };
  lastProgress: number;
}

export class Jobs {
  private readonly repo: JobRepo;
  private readonly kinds = new Map<string, JobKind>();
  private readonly active = new Map<string, Running>();
  private readonly timers: JobTimers;
  private readonly progressInterval: number;
  private started = false;
  private stopped = false;
  private scheduled = false;
  private wake?: unknown;

  constructor(private readonly options: JobsOptions) {
    migrate(options.db, "kernel.jobs", jobsMigrations, options.clock);
    this.repo = new JobRepo(options.db);
    this.timers = options.timers ?? {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) =>
        clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.progressInterval = options.progressIntervalMs ?? 250;
    if (
      !Number.isSafeInteger(this.progressInterval) ||
      this.progressInterval < 0
    )
      throw new AppError("E_INVALID", "任务进度更新间隔无效");
  }

  register(kind: string, definition: JobKind): () => void {
    if (this.started)
      throw new AppError("E_CONFLICT", "请在启动任务服务前注册任务类型");
    if (this.kinds.has(kind))
      throw new AppError("E_CONFLICT", "任务类型已注册");
    if (
      !kind ||
      !Number.isSafeInteger(definition.concurrency) ||
      definition.concurrency < 1 ||
      !Number.isSafeInteger(definition.timeoutMs) ||
      definition.timeoutMs < 1 ||
      definition.timeoutMs > 2_147_483_647
    ) {
      throw new AppError("E_INVALID", "任务类型配置无效");
    }
    this.kinds.set(kind, definition);
    return () => {
      if (this.started)
        throw new AppError("E_CONFLICT", "任务服务运行期间不能移除任务类型");
      this.kinds.delete(kind);
    };
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    for (const job of this.repo.running()) {
      const definition = this.kinds.get(job.kind);
      if (definition?.onBoot === "requeue") {
        this.update(job, {
          state: "queued",
          progress: 0,
          message: "",
          error: null,
        });
      } else {
        this.update(job, {
          state: "failed",
          error: new AppError(
            "E_UNAVAILABLE",
            "服务器重启，任务已中断",
          ).toJSON(),
        });
      }
    }
    this.requestPump();
  }

  enqueue(
    owner: string,
    kind: string,
    payload: unknown,
    options: { runAfter?: number } = {},
  ): Job {
    this.options.assertOwnerWritable?.(owner);
    if (this.stopped) throw new AppError("E_UNAVAILABLE", "任务服务已关闭");
    if (!this.kinds.has(kind))
      throw new AppError("E_NOT_FOUND", "任务类型不存在");
    const now = this.options.clock();
    const runAfter = options.runAfter ?? now;
    if (!owner || !Number.isSafeInteger(runAfter) || runAfter < 0)
      throw new AppError("E_INVALID", "任务所属用户或执行时间无效");
    return this.options.uow.write((ctx) => {
      const job: Job = {
        id: this.options.id(),
        owner,
        kind,
        payload,
        state: "queued",
        progress: 0,
        message: "",
        result: null,
        error: null,
        attempts: 0,
        runAfter,
        created: now,
        updated: now,
        rev: ctx.rev,
        deleted: false,
      };
      if (this.repo.get(job.id))
        throw new AppError("E_CONFLICT", "任务编号已存在");
      this.repo.put(job);
      ctx.changed(`me:${owner}`, "job", job.id);
      ctx.afterCommit(() => this.requestPump());
      return job;
    });
  }

  activeJobs(kind: string, owner?: string): Job[] {
    return this.repo.activeJobs(kind, owner);
  }
  get(id: string): Job | undefined {
    return this.repo.get(id);
  }
  list(owner: string, sinceRev = -1, limit = Number.MAX_SAFE_INTEGER): Job[] {
    return this.repo.list(owner, sinceRev, limit);
  }

  /** Estimate uses this attempt's elapsed runtime, excluding queue/restart time. */
  etaMs(id: string): number | null {
    const job = this.repo.get(id),
      running = this.active.get(id);
    if (
      !job ||
      !running ||
      job.state !== "running" ||
      job.progress <= 0 ||
      job.progress >= 1
    )
      return null;
    const estimate = Math.round(
      (Math.max(0, job.updated - running.started) * (1 - job.progress)) /
        job.progress,
    );
    return Number.isSafeInteger(estimate) ? estimate : null;
  }

  canRetry(kind: string): boolean {
    return this.kinds.get(kind)?.retryable === true;
  }

  retry(owner: string, id: string): Job {
    this.options.assertOwnerWritable?.(owner);
    if (this.stopped) throw new AppError("E_UNAVAILABLE", "任务服务已关闭");
    const job = this.owned(owner, id);
    if (!this.canRetry(job.kind))
      throw new AppError("E_DENIED", "此任务不支持重试");
    if (job.state !== "failed" && job.state !== "cancelled")
      throw new AppError("E_CONFLICT", "只有失败或已取消的任务可以重试");
    if (this.active.has(id))
      throw new AppError("E_CONFLICT", "任务正在停止，请稍后重试");
    return this.options.uow.write((context) => {
      const result = this.update(job, {
        state: "queued",
        progress: 0,
        message: "",
        result: null,
        error: null,
        runAfter: this.options.clock(),
      });
      context.afterCommit(() => this.requestPump());
      return result;
    });
  }

  /** Purge must wait for abort cleanup before deleting domain rows. */
  async cancelOwner(owner: string): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const running of this.active.values()) {
      if (running.owner !== owner) continue;
      if (running.completion) pending.push(running.completion);
      running.controller.abort();
    }
    for (const job of this.list(owner))
      if (!job.deleted) this.cancel(owner, job.id);
    await Promise.all(pending);
  }

  cancel(owner: string, id: string): Job {
    const job = this.owned(owner, id);
    if (job.state !== "queued" && job.state !== "running") return job;
    return this.options.uow.write((context) => {
      const result = this.update(job, {
        state: "cancelled",
        error: new AppError("E_CANCELLED", "任务已取消").toJSON(),
      });
      context.afterCommit(() => {
        const active = this.active.get(id);
        if (active) {
          this.clearTimers(active);
          active.controller.abort();
        }
        this.requestPump();
      });
      return result;
    });
  }

  clear(owner: string, id: string): void {
    const job = this.owned(owner, id);
    if (job.state === "queued" || job.state === "running")
      throw new AppError("E_CONFLICT", "请先取消任务，再清除记录");
    this.update(job, { deleted: true });
  }

  /** Leaves interrupted rows running so the next boot applies each kind's policy. */
  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.wake !== undefined) this.timers.clearTimeout(this.wake);
    for (const running of this.active.values()) {
      this.clearTimers(running);
      running.controller.abort();
    }
  }

  private owned(owner: string, id: string): Job {
    const job = this.repo.get(id);
    if (!job || job.deleted) throw new AppError("E_NOT_FOUND", "任务不存在");
    if (job.owner !== owner)
      throw new AppError("E_DENIED", "无权操作其他用户的任务");
    return job;
  }

  private update(job: Job, patch: Partial<Job>): Job {
    return this.options.uow.write((ctx) => {
      const updated = {
        ...job,
        ...patch,
        rev: ctx.rev,
        updated: this.options.clock(),
      };
      this.repo.put(updated);
      ctx.changed(`me:${job.owner}`, "job", job.id);
      return updated;
    });
  }

  private requestPump(): void {
    if (this.scheduled || !this.started || this.stopped) return;
    this.scheduled = true;
    void Promise.resolve()
      .then(() => {
        this.scheduled = false;
        if (!this.stopped) this.pump();
      })
      .catch((error) => this.report(error));
  }

  private pump(): void {
    if (this.wake !== undefined) this.timers.clearTimeout(this.wake);
    this.wake = undefined;
    let nextWake = Infinity;
    const now = this.options.clock();
    for (const [kind, definition] of this.kinds) {
      let running = 0;
      for (const id of this.active.keys())
        if (this.repo.get(id)?.kind === kind) running++;
      const capacity = definition.concurrency - running;
      if (capacity <= 0) continue;
      for (const job of this.repo.due(kind, now, capacity))
        this.run(job, definition);
      const next = this.repo.next(kind);
      if (next !== undefined && next > now) nextWake = Math.min(nextWake, next);
    }
    if (Number.isFinite(nextWake)) {
      this.wake = this.timers.setTimeout(
        () => {
          this.wake = undefined;
          this.requestPump();
        },
        Math.min(2_147_483_647, Math.max(0, nextWake - now)),
      );
    }
  }

  private run(job: Job, definition: JobKind): void {
    try {
      this.options.assertOwnerWritable?.(job.owner);
    } catch {
      this.cancel(job.owner, job.id);
      return;
    }
    this.update(job, { state: "running", attempts: job.attempts + 1 });
    const running: Running = {
      owner: job.owner,
      started: this.options.clock(),
      controller: new AbortController(),
      lastProgress: -Infinity,
    };
    this.active.set(job.id, running);
    running.timeout = this.timers.setTimeout(() => {
      running.timeout = undefined;
      try {
        this.finish(
          job.id,
          running,
          undefined,
          new AppError("E_TIMEOUT", "任务执行超时"),
        );
      } catch (error) {
        this.report(error);
      } finally {
        running.controller.abort();
      }
    }, definition.timeoutMs);
    running.completion = Promise.resolve()
      .then(() => {
        if (this.stopped || running.controller.signal.aborted) return undefined;
        return definition.run({
          id: job.id,
          owner: job.owner,
          payload: job.payload,
          signal: running.controller.signal,
          progress: (value, message = "") =>
            this.progress(job.id, running, value, message),
        });
      })
      .then(
        (result) =>
          this.finish(job.id, running, result === undefined ? null : result),
        (error) => this.finish(job.id, running, undefined, error),
      )
      .catch((error) => this.report(error))
      .finally(() => {
        this.clearTimers(running);
        this.active.delete(job.id);
        this.requestPump();
      });
  }

  private progress(
    id: string,
    running: Running,
    value: number,
    message: string,
  ): void {
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1 ||
      typeof message !== "string"
    )
      throw new AppError("E_INVALID", "任务进度无效");
    if (this.stopped || running.controller.signal.aborted) return;
    running.pending = { value, message };
    const elapsed = this.options.clock() - running.lastProgress;
    if (elapsed >= this.progressInterval) this.flushProgress(id, running);
    else if (running.progressTimer === undefined) {
      running.progressTimer = this.timers.setTimeout(
        () => {
          running.progressTimer = undefined;
          try {
            this.flushProgress(id, running);
          } catch (error) {
            this.report(error);
          }
        },
        Math.max(0, this.progressInterval - elapsed),
      );
    }
  }

  private flushProgress(id: string, running: Running): void {
    const pending = running.pending;
    running.pending = undefined;
    if (!pending || this.stopped) return;
    const job = this.repo.get(id);
    if (!job || job.state !== "running") return;
    if (job.progress !== pending.value || job.message !== pending.message)
      this.update(job, { progress: pending.value, message: pending.message });
    running.lastProgress = this.options.clock();
  }

  private finish(
    id: string,
    running: Running,
    result: unknown,
    error?: unknown,
  ): void {
    this.clearTimers(running);
    if (this.stopped) return;
    this.flushProgress(id, running);
    const job = this.repo.get(id);
    if (!job || job.state !== "running") return;
    if (error !== undefined) {
      if (!(error instanceof AppError)) this.report(error);
      const failure =
        error instanceof AppError
          ? error
          : new AppError("E_INTERNAL", "任务执行失败，请稍后重试");
      this.update(job, {
        state: failure.code === "E_CANCELLED" ? "cancelled" : "failed",
        error: failure.toJSON(),
      });
    } else {
      try {
        this.update(job, { state: "done", progress: 1, result });
      } catch (failure) {
        this.report(failure);
        this.update(job, {
          state: "failed",
          error: new AppError(
            "E_INTERNAL",
            "任务结果无效，请稍后重试",
          ).toJSON(),
        });
      }
    }
  }

  private clearTimers(running: Running): void {
    if (running.timeout !== undefined)
      this.timers.clearTimeout(running.timeout);
    if (running.progressTimer !== undefined)
      this.timers.clearTimeout(running.progressTimer);
    running.timeout = undefined;
    running.progressTimer = undefined;
  }
  private report(error: unknown): void {
    try {
      this.options.reportError?.(error);
    } catch {
      /* Reporting is isolated from runner state. */
    }
  }
}
