import type { ReactElement } from "react";
import { Icon } from "../icon/icon.tsx";
import type { IconName } from "../icon/icon.tsx";
import "./status.css";
/** What the status entry displays; callers map their own model onto it. */
export interface StatusPillModel {
  connection: "connected" | "connecting" | "offline" | "syncing";
  syncingCount?: number;
  pending: number;
  failed: number;
  update: { state: "none" | "installing" | "ready" | "applying" | "failed" };
}
const labels = {
  connected: "已连接",
  connecting: "连接中",
  offline: "离线",
  syncing: "同步中",
};
const icons: Record<StatusPillModel["connection"], IconName> = {
  connected: "connected",
  connecting: "sync",
  offline: "offline",
  syncing: "sync",
};
function summary(model: StatusPillModel): string {
  return `${labels[model.connection]}，${model.pending}项待处理，${model.failed}项失败`;
}
/**
 * The single home of system state. `rail` renders the rail entry (icon over label);
 * otherwise a compact pill for gate screens.
 */
export function StatusPill({
  model,
  onClick,
  rail = false,
}: {
  rail?: boolean;
  model: StatusPillModel;
  onClick?: () => void;
}): ReactElement {
  const count = model.pending + model.failed;
  const spinning =
    model.connection === "syncing" || model.connection === "connecting";
  const label =
    model.connection === "syncing"
      ? `同步中 ${model.syncingCount || 0}`
      : labels[model.connection];
  const updateReady = model.update.state === "ready";
  return (
    <button
      type="button"
      data-testid="ui.status"
      className={`status-entry status-${model.connection}${rail ? " is-rail" : " is-pill"}${model.failed ? " has-failed" : count ? " has-pending" : ""}`}
      onClick={onClick}
      aria-label={rail ? "状态" : `打开同步与任务，${summary(model)}`}
      title={summary(model)}
    >
      <span className="status-glyph">
        <Icon
          name={icons[model.connection]}
          size={rail ? 22 : 16}
          spin={spinning}
        />
        {count > 0 && (
          <span className="status-count">{count > 99 ? "99+" : count}</span>
        )}
        {!count && updateReady && <span className="status-dot" />}
      </span>
      <span className="status-label">{label}</span>
    </button>
  );
}
