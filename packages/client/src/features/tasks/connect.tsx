import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { contract } from "@talos/contract";
import {
  useCan,
  useClientSnapshot,
  useRepository,
  useRuntime,
} from "../../platform/react/context.tsx";
import {
  TaskController,
  canCancelTask,
  canClearHistory,
  canRetryTask,
  confirmationName,
  selectTasks,
  taskDetail,
  taskMark,
  taskMarkLabel,
  taskTitle,
  tasksHint,
} from "./model.ts";
import { TasksSheetView } from "./view.tsx";

export function TasksSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}): ReactElement {
  const runtime = useRuntime(),
    snapshot = useClientSnapshot();
  const tasks = selectTasks(
    useRepository(runtime.repositories.get("tasks.jobs")!),
  );
  const canClear = useCan(contract.tasks.clear),
    canRetry = useCan(contract.tasks.retry),
    canCancel = useCan(contract.tasks.cancel);
  const [controller] = useState(() => new TaskController(runtime));
  const { busy, error, confirmation } = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const offline = snapshot.status.connection === "offline";
  return (
    <TasksSheetView
      open={open}
      hint={tasksHint(offline)}
      offline={offline}
      busy={busy}
      error={error}
      showClear={canClearHistory(tasks)}
      clearReason={canClear.ok ? undefined : canClear.reason}
      retryReason={canRetry.ok ? undefined : canRetry.reason}
      cancelReason={canCancel.ok ? undefined : canCancel.reason}
      tasks={tasks.map((task) => ({
        id: task.id,
        kind: task.kind,
        state: task.state,
        progress: task.progress,
        title: taskTitle(task),
        detail: taskDetail(task),
        mark: taskMark(task),
        markLabel: taskMarkLabel(task),
        retry: canRetryTask(task),
        cancel: canCancelTask(task),
      }))}
      confirmation={
        confirmation && {
          objectName: confirmationName(confirmation),
          destructive: !!confirmation.clear,
        }
      }
      onClose={onClose}
      onClear={controller.askClear}
      onRetry={(id) => {
        const task = tasks.find((t) => t.id === id);
        if (task) controller.retry(task);
      }}
      onCancel={(id) => {
        const task = tasks.find((t) => t.id === id);
        if (task) controller.askCancel(task);
      }}
      onDismiss={controller.dismiss}
      onConfirm={controller.confirm}
    />
  );
}
