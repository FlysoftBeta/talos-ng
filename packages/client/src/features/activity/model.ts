import { contract } from "@talos/contract";
import type { RuntimeCommandPort } from "../../core/runtime-port.ts";
import type {
  OutboundView,
  ScopeView,
  StatusViewModel,
  TransferView,
} from "../../core/status/model.ts";
import {
  HISTORY_LIMIT,
  canCancelTask,
  canRetryTask,
  taskDetail,
  taskError,
  taskTitle,
} from "./jobs.ts";
import type { Task } from "./jobs.ts";

export type ActivityKind = "job" | "outbound" | "download" | "upload";
export interface ActivityAction {
  label: string;
  run(): void;
  /** Object name for a confirmation dialog; absent when the action runs at once. */
  confirm?: string;
}
/** One row of the centre, whatever produced it: a job, a queued write or a transfer. */
export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  /** Job kind, only for choosing an icon. */
  jobKind?: string;
  title: string;
  detail: string;
  progress?: number;
  mark?: "pending" | "failed";
  markLabel?: string;
  error?: string;
  retry?: ActivityAction;
  cancel?: ActivityAction;
  /** Why the actions are unavailable right now (offline, no permission). */
  blocked?: string;
}
export interface ActivityModel {
  /** Running work, uploads and writes that have not been sent yet. */
  active: readonly ActivityItem[];
  /** Failed work: errors can be viewed, retried or cancelled. */
  attention: readonly ActivityItem[];
  /** Finished jobs and transfers, newest first. */
  completed: readonly ActivityItem[];
  scopes: readonly ScopeView[];
  /** Scopes already usable while the rest still load. */
  scopesReady: number;
}
export interface JobActions {
  retry(task: Task): void;
  cancel(task: Task): void;
  blocked: { retry?: string; cancel?: string };
}
/** Completed records beyond this many are left out of the list. */
const COMPLETED_LIMIT = 30;

function outboundItem(op: OutboundView, offline: boolean): ActivityItem {
  const detail = {
    waiting: op.merged
      ? `已合并 ${op.merged} 次更改，稍后一并发送`
      : "稍后发送",
    pending: offline ? "离线，联网后自动发送" : "等待发送",
    sending: "发送中",
    failed: op.error ? `同步失败 · ${op.error}` : "同步失败",
  }[op.state];
  return {
    id: `op:${op.id}`,
    kind: "outbound",
    title: op.title,
    detail,
    mark: op.state === "failed" ? "failed" : "pending",
    markLabel: op.state === "failed" ? "同步失败" : "待同步",
    ...(op.error ? { error: op.error } : {}),
    ...(op.retry ? { retry: { label: "重试", run: op.retry } } : {}),
    ...(op.discard ? { cancel: { label: "放弃", run: op.discard } } : {}),
  };
}
function transferItem(t: TransferView): ActivityItem {
  const upload = t.direction === "upload";
  return {
    id: `xfer:${t.id}`,
    kind: t.direction,
    title: t.title,
    detail: t.error
      ? `${upload ? "上传" : "下载"}失败 · ${t.error}`
      : t.progress >= 1
        ? upload
          ? "已上传"
          : "已保存到本机"
        : `${upload ? "上传中" : "下载中"} · ${Math.round(t.progress * 100)}%`,
    ...(t.error || t.progress >= 1 ? {} : { progress: t.progress }),
    ...(t.error ? { error: t.error, mark: "failed" as const } : {}),
    ...(t.retry ? { retry: { label: "重试", run: t.retry } } : {}),
    ...(t.cancel
      ? {
          cancel: { label: "取消", run: t.cancel, confirm: `取消${t.title}` },
        }
      : {}),
  };
}
function jobItem(task: Task, actions: JobActions): ActivityItem {
  const error = taskError(task);
  const retry = canRetryTask(task),
    cancel = canCancelTask(task);
  const blocked = retry
    ? actions.blocked.retry
    : cancel
      ? actions.blocked.cancel
      : undefined;
  return {
    id: `job:${task.id}`,
    kind: "job",
    jobKind: task.kind,
    title: taskTitle(task),
    detail: taskDetail(task),
    ...(task.state === "running" ? { progress: task.progress } : {}),
    ...(task.state === "queued"
      ? { mark: "pending" as const, markLabel: "待处理" }
      : task.state === "failed"
        ? { mark: "failed" as const, markLabel: "失败" }
        : {}),
    ...(task.state === "failed" && error ? { error } : {}),
    ...(retry
      ? { retry: { label: "重试", run: () => actions.retry(task) } }
      : {}),
    ...(cancel
      ? {
          cancel: {
            label: "取消任务",
            run: () => actions.cancel(task),
            confirm: `取消${taskTitle(task)}`,
          },
        }
      : {}),
    ...(blocked ? { blocked } : {}),
  };
}
/** Groups every kind of background work into the centre's three lists. */
export function buildActivity(
  status: StatusViewModel,
  jobs: readonly Task[],
  actions: JobActions,
): ActivityModel {
  const offline = status.connection === "offline";
  const active: ActivityItem[] = [],
    attention: ActivityItem[] = [],
    completed: ActivityItem[] = [];
  for (const op of status.operations)
    (op.state === "failed" ? attention : active).push(
      outboundItem(op, offline),
    );
  for (const t of status.transfers)
    (t.error ? attention : t.progress >= 1 ? completed : active).push(
      transferItem(t),
    );
  for (const task of jobs) {
    const item = jobItem(task, actions);
    if (offline && (item.retry || item.cancel)) item.blocked = "需要连接服务器";
    (task.state === "failed"
      ? attention
      : task.state === "queued" || task.state === "running"
        ? active
        : completed
    ).push(item);
  }
  return {
    active,
    attention,
    completed: completed.slice(0, COMPLETED_LIMIT),
    scopes: status.scopes,
    scopesReady: status.scopes.filter((scope) => scope.state === "ready")
      .length,
  };
}

export interface Confirmation {
  name: string;
  destructive: boolean;
  run(): void;
}
export interface ActivityState {
  busy: boolean;
  error: string;
  confirmation: Confirmation | undefined;
}
export type ActivityPort = Pick<RuntimeCommandPort, "command">;

/** Job commands plus confirmation and error sequencing for every action in the centre. */
export class ActivityController {
  private listeners = new Set<() => void>();
  private state: ActivityState = {
    busy: false,
    error: "",
    confirmation: undefined,
  };
  constructor(private readonly port: ActivityPort) {}
  getState = (): ActivityState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private patch(value: Partial<ActivityState>): void {
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
  retryJob = (task: Task): void =>
    this.perform(() =>
      this.port.command(contract.tasks.retry, { id: task.id }),
    );
  cancelJob = (task: Task): void =>
    this.perform(() =>
      this.port.command(contract.tasks.cancel, { id: task.id }),
    );
  /** Runs an item's action now, or after confirmation when it names one. */
  invoke = (action: ActivityAction): void =>
    action.confirm
      ? this.patch({
          confirmation: {
            name: action.confirm,
            destructive: false,
            run: action.run,
          },
        })
      : action.run();
  askClear = (): void =>
    this.patch({
      confirmation: {
        name: `清理较早的任务历史（保留最近 ${HISTORY_LIMIT} 条）`,
        destructive: true,
        run: () =>
          this.perform(() => this.port.command(contract.tasks.clear, {})),
      },
    });
  dismiss = (): void => this.patch({ confirmation: undefined });
  confirm = (): void => {
    const held = this.state.confirmation;
    this.patch({ confirmation: undefined });
    held?.run();
  };
}
