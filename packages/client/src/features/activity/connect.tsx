import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { contract } from "@talos/contract";
import type { StatusViewModel } from "../../core/status/model.ts";
import {
  useCan,
  useClientSnapshot,
  useRepository,
  useRuntime,
} from "../../platform/react/context.tsx";
import { canClearHistory, selectTasks } from "./jobs.ts";
import type { Task } from "./jobs.ts";
import { ActivityController, buildActivity } from "./model.ts";
import { ActivityView } from "./view.tsx";

function useJobs(): Task[] {
  const runtime = useRuntime();
  return selectTasks(useRepository(runtime.repositories.get("tasks.jobs")!));
}

/** Entry badge counts: queued writes and jobs together, so one number covers everything. */
export function useActivityCounts(status: StatusViewModel): {
  pending: number;
  failed: number;
} {
  const jobs = useJobs();
  return {
    pending:
      status.pending +
      jobs.filter((job) => job.state === "queued" || job.state === "running")
        .length,
    failed: status.failed + jobs.filter((job) => job.state === "failed").length,
  };
}

export function ActivityCenter({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}): ReactElement {
  const runtime = useRuntime(),
    snapshot = useClientSnapshot();
  const jobs = useJobs();
  const canClear = useCan(contract.tasks.clear),
    canRetry = useCan(contract.tasks.retry),
    canCancel = useCan(contract.tasks.cancel);
  const [controller] = useState(() => new ActivityController(runtime));
  const { busy, error, confirmation } = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const activity = buildActivity(snapshot.status, jobs, {
    retry: controller.retryJob,
    cancel: controller.cancelJob,
    blocked: {
      retry: canRetry.ok ? undefined : canRetry.reason,
      cancel: canCancel.ok ? undefined : canCancel.reason,
    },
  });
  const offline = snapshot.status.connection === "offline";
  return (
    <ActivityView
      open={open}
      status={snapshot.status}
      activity={activity}
      busy={busy}
      error={error}
      showClear={canClearHistory(jobs)}
      clearBlocked={
        offline ? "需要连接服务器" : canClear.ok ? undefined : canClear.reason
      }
      confirmation={confirmation}
      onClose={onClose}
      onInvoke={controller.invoke}
      onClear={controller.askClear}
      onDismiss={controller.dismiss}
      onConfirm={controller.confirm}
    />
  );
}
