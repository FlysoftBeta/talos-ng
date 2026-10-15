import type { ReactElement } from "react";
import { Button } from "../../ui/actions/index.ts";
import { ConfirmDialog, Sheet } from "../../ui/overlays/index.ts";
import { Inline, SectionHeader, Stack } from "../../ui/layout/index.ts";
import { ListRow, Progress, StatePanel } from "../../ui/feedback/index.ts";
import { Icon } from "../../ui/icon/index.ts";
import type { IconName } from "../../ui/icon/index.ts";
import "./tasks.css";
import type { TaskMark } from "./model.ts";

export interface TaskRowView {
  id: string;
  kind: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  title: string;
  detail: string;
  mark: TaskMark;
  markLabel: string | undefined;
  retry: boolean;
  cancel: boolean;
}
export function TasksSheetView({
  open,
  hint,
  tasks,
  offline,
  busy,
  error,
  showClear,
  clearReason,
  retryReason,
  cancelReason,
  confirmation,
  onClose,
  onClear,
  onRetry,
  onCancel,
  onDismiss,
  onConfirm,
}: {
  open: boolean;
  hint: string;
  tasks: readonly TaskRowView[];
  offline: boolean;
  busy: boolean;
  error: string;
  showClear: boolean;
  clearReason: string | undefined;
  retryReason: string | undefined;
  cancelReason: string | undefined;
  confirmation: { objectName: string; destructive: boolean } | undefined;
  onClose(): void;
  onClear(): void;
  onRetry(id: string): void;
  onCancel(id: string): void;
  onDismiss(): void;
  onConfirm(): void;
}): ReactElement {
  const icon = (kind: string): IconName => {
    if (/^(library|document)\./.test(kind)) return "library";
    if (kind.startsWith("netbooks.")) return "download";
    if (kind.startsWith("media.")) return "media";
    if (kind.startsWith("ai.")) return "ai";
    if (kind.startsWith("ops.")) return "settings";
    return "tasks";
  };
  return (
    <>
      <Sheet
        open={open}
        title="任务"
        subtitle={hint}
        onClose={onClose}
        actions={
          showClear && (
            <Button
              variant="ghost"
              busy={busy}
              disabledReason={offline ? "需要连接服务器" : clearReason}
              onClick={onClear}
            >
              清理历史
            </Button>
          )
        }
      >
        <Stack>
          {error && <StatePanel state="error" hint={error} />}
          {tasks.length === 0 ? (
            <StatePanel
              state="empty"
              title="没有后台任务"
              hint={offline ? hint : "文档转换等后台任务会显示在这里"}
            />
          ) : (
            [true, false].map((active) => {
              const rows = tasks.filter(
                (task) =>
                  (task.state === "queued" || task.state === "running") ===
                  active,
              );
              return (
                rows.length > 0 && (
                  <section key={String(active)}>
                    <SectionHeader title={active ? "进行中" : "已结束"} />
                    {rows.map((task) => (
                      <div key={task.id} className="tasks-item">
                        <ListRow
                          title={task.title}
                          hint={task.detail}
                          leading={<Icon name={icon(task.kind)} />}
                          trailing={
                            <Inline>
                              {task.retry && (
                                <Button
                                  size="small"
                                  variant="ghost"
                                  busy={busy}
                                  disabledReason={
                                    offline ? "需要连接服务器" : retryReason
                                  }
                                  onClick={() => onRetry(task.id)}
                                >
                                  重试
                                </Button>
                              )}
                              {task.cancel && (
                                <Button
                                  size="small"
                                  variant="ghost"
                                  busy={busy}
                                  disabledReason={
                                    offline ? "需要连接服务器" : cancelReason
                                  }
                                  onClick={() => onCancel(task.id)}
                                >
                                  取消任务
                                </Button>
                              )}
                            </Inline>
                          }
                        />
                        {task.state === "running" && (
                          <div className="tasks-progress">
                            <Progress
                              value={task.progress}
                              label={`${task.title}进度`}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </section>
                )
              );
            })
          )}
        </Stack>
      </Sheet>
      <ConfirmDialog
        open={open && !!confirmation}
        objectName={confirmation?.objectName ?? ""}
        destructive={!!confirmation?.destructive}
        onClose={onDismiss}
        onConfirm={onConfirm}
      />
    </>
  );
}
