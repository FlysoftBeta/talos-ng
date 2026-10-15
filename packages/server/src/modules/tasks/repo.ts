import type { Row } from "@talos/sync";
import type { Job, Jobs } from "../../kernel/jobs/jobs.ts";

/** Projection has no SQL: kernel.jobs is the sole owner of job storage. */
export class TasksRepo {
  constructor(private readonly jobs: Jobs) {}
  read(scope: string, id: string): Row | undefined {
    const job = this.jobs.get(id);
    return job && scope === `me:${job.owner}`
      ? jobRow(job, this.jobs.canRetry(job.kind), this.jobs.etaMs(job.id))
      : undefined;
  }
  select(scope: string, sinceRev: number, limit: number): Row[] {
    return this.jobs
      .list(scope.slice(3), sinceRev, limit)
      .map((job) =>
        jobRow(job, this.jobs.canRetry(job.kind), this.jobs.etaMs(job.id)),
      );
  }
  owned(owner: string): Job[] {
    return this.jobs.list(owner);
  }
}
export function jobRow(
  job: Job,
  retryable = false,
  etaMs: number | null = null,
): Row {
  const payload = job.payload as { title?: unknown } | null;
  const title =
    payload && typeof payload.title === "string"
      ? payload.title.slice(0, 500)
      : "";
  const {
    id,
    kind,
    owner,
    state,
    progress,
    message,
    result,
    error,
    attempts,
    created,
    updated,
  } = job;
  return {
    type: "job",
    id,
    rev: job.rev,
    deleted: job.deleted,
    data: job.deleted
      ? null
      : {
          id,
          kind,
          title,
          owner,
          state,
          progress,
          message,
          result,
          error,
          attempts,
          created,
          updated,
          retryable,
          etaMs,
        },
  };
}
