import { contract } from "@talos/contract";
import type { z } from "@talos/contract";
import type { StoredRow } from "../../core/data/db.ts";
import type { RuntimeCommandPort } from "../../core/runtime-port.ts";
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
  const error = task.error;
  if (
    (task.state === "failed" || task.state === "cancelled") &&
    error &&
    typeof error === "object" &&
    !Array.isArray(error) &&
    typeof error.message === "string"
  )
    details.push(error.message);
  return details.join(" · ");
}

export type TaskMark = "failed" | "pending" | undefined;
export const taskMark = (task: Task): TaskMark =>
  task.state === "failed"
    ? "failed"
    : task.state === "queued"
      ? "pending"
      : undefined;
export const taskMarkLabel = (task: Task): string | undefined =>
  task.state === "failed"
    ? "失败"
    : task.state === "queued"
      ? "待处理"
      : undefined;
export const canRetryTask = (task: Task): boolean =>
  (task.state === "failed" || task.state === "cancelled") && task.retryable;
export const canCancelTask = (task: Task): boolean =>
  task.state === "queued" || task.state === "running";
/** More than this many finished records offers history cleanup. */
export const HISTORY_LIMIT = 100;
export const canClearHistory = (tasks: readonly Task[]): boolean =>
  tasks.filter((task) => task.state !== "running" && task.state !== "queued")
    .length > HISTORY_LIMIT;
export const tasksHint = (offline: boolean): string =>
  offline
    ? "当前显示本机记录；连接后自动更新"
    : "进度自动同步，可关闭此面板继续阅读";

export interface Confirmation {
  task?: Task;
  clear?: boolean;
}
export const confirmationName = (confirmation: Confirmation | undefined) =>
  confirmation?.clear
    ? "清理较早的任务历史（保留最近 100 条）"
    : `取消${confirmation?.task ? taskTitle(confirmation.task) : "任务"}`;
export interface TaskState {
  busy: boolean;
  error: string;
  confirmation: Confirmation | undefined;
}
export type TaskPort = Pick<RuntimeCommandPort, "command">;

/** Retry, cancel and history cleanup; cancel and cleanup wait for confirmation. */
export class TaskController {
  private listeners = new Set<() => void>();
  private state: TaskState = {
    busy: false,
    error: "",
    confirmation: undefined,
  };
  constructor(private readonly port: TaskPort) {}
  getState = (): TaskState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private patch(value: Partial<TaskState>): void {
    this.state = { ...this.state, ...value };
    this.listeners.forEach((listener) => listener());
  }
  private perform(action: () => Promise<unknown>): void {
    this.patch({ busy: true, error: "" });
    void action()
      .catch((e: unknown) =>
        this.patch({
          error: e instanceof Error ? e.message : "操作失败，请重试",
        }),
      )
      .finally(() => this.patch({ busy: false }));
  }
  retry = (task: Task): void =>
    this.perform(() =>
      this.port.command(contract.tasks.retry, { id: task.id }),
    );
  askCancel = (task: Task): void => this.patch({ confirmation: { task } });
  askClear = (): void => this.patch({ confirmation: { clear: true } });
  dismiss = (): void => this.patch({ confirmation: undefined });
  confirm = (): void => {
    const held = this.state.confirmation;
    this.patch({ confirmation: undefined });
    if (held?.clear)
      this.perform(() => this.port.command(contract.tasks.clear, {}));
    else if (held?.task)
      this.perform(() =>
        this.port.command(contract.tasks.cancel, { id: held.task!.id }),
      );
  };
}
