import { contract } from "@talos/contract";
import type { z } from "@talos/contract";
import type { StoredRow } from "../../core/data/db.ts";
export type Task = z.output<typeof contract.tasks.job.schema>;
export function selectTasks(rows: readonly StoredRow[]): Task[] {
  const tasks: Task[] = [];
  for (const row of rows) {
    if (row.type !== "job" || row.deleted) continue;
    const parsed = contract.tasks.job.schema.safeParse(row.data);
    if (parsed.success) tasks.push(parsed.data);
  }
  return tasks.sort(
    (a, b) => b.created - a.created || b.id.localeCompare(a.id),
  );
}
const labels: Readonly<Record<string, string>> = {
  "library.convert": "文档转换",
  "library.pdf": "PDF 转换",
  "document.convert": "文档转换",
  "debug.sleep": "调试任务",
  "ops.backup.daily": "自动备份",
};
export function taskTitle(task: Task): string {
  return task.title || labels[task.kind] || "后台任务";
}
export function taskDetail(task: Task): string {
  const state = {
    queued: "排队中",
    running: "进行中",
    done: "已完成",
    failed: "失败",
    cancelled: "已取消",
  }[task.state];
  const details = [state];
  if (task.state === "running") {
    details.push(`${Math.round(task.progress * 100)}%`);
    if (task.etaMs !== null)
      details.push(`预计剩余 ${Math.ceil(task.etaMs / 1000)} 秒`);
  }
  if ((task.state === "queued" || task.state === "running") && task.message)
    details.push(task.message);
  const error = taskError(task);
  if ((task.state === "failed" || task.state === "cancelled") && error)
    details.push(error);
  return details.join(" · ");
}

/** The structured error message of a job, when it carries one. */
export function taskError(task: Task): string | undefined {
  const error = task.error;
  return error &&
    typeof error === "object" &&
    !Array.isArray(error) &&
    typeof error.message === "string"
    ? error.message
    : undefined;
}
export const canRetryTask = (task: Task): boolean =>
  (task.state === "failed" || task.state === "cancelled") && task.retryable;
export const canCancelTask = (task: Task): boolean =>
  task.state === "queued" || task.state === "running";
/** More than this many finished records offers history cleanup. */
export const HISTORY_LIMIT = 100;
export const canClearHistory = (tasks: readonly Task[]): boolean =>
  tasks.filter((task) => task.state !== "running" && task.state !== "queued")
    .length > HISTORY_LIMIT;
