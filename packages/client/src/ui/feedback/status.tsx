import type { ReactElement } from "react";
import { Sheet } from "../overlays/overlays.tsx";
import { Group, GroupRow } from "../layout/layout.tsx";
import { Button } from "../actions/button.tsx";
import { Mark, Progress } from "./feedback.tsx";
import { Icon } from "../icon/icon.tsx";
import type { IconName } from "../icon/icon.tsx";
import "./status.css";
/** What the status entry and centre display; callers map their own model onto it. */
export interface StatusViewModel {
  connection: "connected" | "connecting" | "offline" | "syncing";
  syncingCount?: number;
  lastSync: string;
  pending: number;
  failed: number;
  operations: readonly {
    id: string;
    title: string;
    state: "pending" | "failed";
    retry?: () => void;
    discard?: () => void;
  }[];
  downloads: readonly { id: string; title: string; progress: number }[];
  storage: string;
  build: string;
  update: {
    state: "none" | "installing" | "ready" | "applying" | "failed";
    progress?: number;
    message?: string;
    apply?: () => void;
  };
}
const labels = {
  connected: "已连接",
  connecting: "连接中",
  offline: "离线",
  syncing: "同步中",
};
const icons: Record<StatusViewModel["connection"], IconName> = {
  connected: "connected",
  connecting: "sync",
  offline: "offline",
  syncing: "sync",
};
function summary(model: StatusViewModel): string {
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
  model: StatusViewModel;
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
      aria-label={rail ? "状态" : `打开状态中心，${summary(model)}`}
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
export function StatusCenter({
  open,
  model,
  onClose,
}: {
  open: boolean;
  model: StatusViewModel;
  onClose: () => void;
}): ReactElement {
  const update = {
    none: "已是当前版本",
    installing: "正在保存新版本",
    ready: "新版本已就绪",
    applying: "正在应用新版本",
    failed: "更新失败",
  }[model.update.state];
  return (
    <Sheet open={open} title="状态中心" onClose={onClose}>
      <div className={`status-hero status-${model.connection}`}>
        <span className="status-hero-icon">
          <Icon
            name={icons[model.connection]}
            size={22}
            spin={
              model.connection === "syncing" ||
              model.connection === "connecting"
            }
          />
        </span>
        <div>
          <strong>
            {labels[model.connection]}
            {model.connection === "syncing" && ` ${model.syncingCount || 0}`}
          </strong>
          <span>上次同步 {model.lastSync}</span>
        </div>
      </div>
      <Group
        title="待处理的更改"
        hint={
          model.pending + model.failed
            ? `${model.pending} 项待同步 · ${model.failed} 项失败`
            : undefined
        }
      >
        {model.operations.length ? (
          model.operations.map((op) => (
            <div className="status-op" key={op.id}>
              <div className="status-op-copy">
                <span className="ellipsis">{op.title}</span>
                <Mark
                  state={op.state}
                  label={op.state === "pending" ? "待同步" : "同步失败"}
                />
              </div>
              {(op.retry || op.discard) && (
                <div className="status-op-actions">
                  {op.discard && (
                    <Button size="small" variant="ghost" onClick={op.discard}>
                      放弃
                    </Button>
                  )}
                  {op.retry && (
                    <Button size="small" onClick={op.retry}>
                      重试
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))
        ) : (
          <GroupRow label="所有更改已保存">
            <Icon name="check" size={18} />
          </GroupRow>
        )}
      </Group>
      <Group title="下载">
        {model.downloads.length ? (
          model.downloads.map((d) => (
            <div className="status-download" key={d.id}>
              <div className="status-op-copy">
                <span className="ellipsis">{d.title}</span>
                <span className="muted num">
                  {Math.round(d.progress * 100)}%
                </span>
              </div>
              <Progress label={`${d.title}下载进度`} value={d.progress} />
            </div>
          ))
        ) : (
          <GroupRow label="没有正在下载的内容" />
        )}
      </Group>
      <Group title="本机与版本">
        <GroupRow label="存储用量">{model.storage}</GroupRow>
        <GroupRow label="当前版本">
          <span className="selectable">{model.build}</span>
        </GroupRow>
        <GroupRow
          label={update}
          hint={model.update.message}
          stacked={model.update.state === "installing"}
        >
          {model.update.state === "installing" ? (
            <Progress label="更新进度" value={model.update.progress || 0} />
          ) : model.update.apply ? (
            <Button variant="primary" size="small" onClick={model.update.apply}>
              应用新版本
            </Button>
          ) : model.update.state === "failed" ? (
            <Icon name="error" size={18} />
          ) : undefined}
        </GroupRow>
      </Group>
    </Sheet>
  );
}
