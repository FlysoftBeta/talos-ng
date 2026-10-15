import { contract } from "@talos/contract";
import type { StoredRow } from "../../../core/data/db.ts";

export type NetbookJob = ReturnType<typeof decodeJobs>[number];
/** Valid job rows of the tasks repository. */
export function decodeJobs(rows: readonly StoredRow[]) {
  return rows
    .filter((row) => row.type === "job" && !row.deleted)
    .map((row) => contract.tasks.job.schema.safeParse(row.data))
    .map((result) => (result.success ? result.data : null))
    .filter((job): job is NonNullable<typeof job> => job !== null);
}
/** Progress text of a submitted download: percentage while running, otherwise a fixed label. */
export function downloadLabel(
  jobs: readonly NetbookJob[],
  jobId: string,
): string {
  const job = jobs.find((value) => value.id === jobId);
  return job?.state === "running"
    ? `${Math.round((job.progress ?? 0) * 100)}%`
    : "已在任务中";
}
