import { useState } from "react";
import type { ReactElement } from "react";
import type { StatusViewModel } from "../../core/status/model.ts";
import { Button } from "../../ui/actions/index.ts";
import { ConfirmDialog, Sheet } from "../../ui/overlays/index.ts";
import { Group, GroupRow, SectionHeader } from "../../ui/layout/index.ts";
import { Mark, Progress, StatePanel } from "../../ui/feedback/index.ts";
import { Icon } from "../../ui/icon/index.ts";
import type { IconName } from "../../ui/icon/index.ts";
import "./activity.css";
import type { ActivityAction, ActivityItem, ActivityModel } from "./model.ts";

const connectionLabels = {
  connected: "已连接",
  connecting: "连接中",
  offline: "离线",
  syncing: "同步中",
};
const connectionIcons: Record<StatusViewModel["connection"], IconName> = {
  connected: "connected",
  connecting: "sync",
  offline: "offline",
  syncing: "sync",
};
const updateLabels = {
  none: "已是当前版本",
  installing: "正在保存新版本",
  ready: "新版本已就绪",
  applying: "正在应用新版本",
  failed: "更新失败",
};
const scopeStates = {
  ready: "已可用",
  loading: "正在同步",
  waiting: "等待中",
};

function itemIcon(item: ActivityItem): IconName {
  if (item.kind === "upload") return "upload";
  if (item.kind === "download") return "download";
  if (item.kind === "outbound") return "send";
  const kind = item.jobKind ?? "";
  if (/^(library|document)\./.test(kind)) return "library";
  if (kind.startsWith("netbooks.")) return "download";
  if (kind.startsWith("media.")) return "media";
  if (kind.startsWith("ai.")) return "ai";
  if (kind.startsWith("ops.")) return "settings";
  return "tasks";
}

function ActivityRow({
  item,
  busy,
  onInvoke,
}: {
  item: ActivityItem;
  busy: boolean;
  onInvoke(action: ActivityAction): void;
}): ReactElement {
  const [showError, setShowError] = useState(false);
  const action = (value: ActivityAction, primary: boolean) => (
    <Button
      size="small"
      variant={primary ? "primary" : "ghost"}
      busy={busy}
      disabledReason={item.blocked}
      onClick={() => onInvoke(value)}
    >
      {value.label}
    </Button>
  );
  return (
    <div className="activity-item" data-testid="activity.item">
      <div className="activity-item-main">
        <span className="activity-item-icon">
          <Icon name={itemIcon(item)} size={20} />
        </span>
        <div className="activity-item-copy">
          <span className="ellipsis activity-item-title">{item.title}</span>
          <span className="activity-item-detail">{item.detail}</span>
        </div>
        {item.mark && (
          <Mark state={item.mark} label={item.markLabel ?? undefined} />
        )}
      </div>
      {item.progress !== undefined && (
        <div className="activity-item-progress">
          <Progress value={item.progress} label={`${item.title}进度`} />
        </div>
      )}
      {showError && item.error && (
        <p className="activity-item-error" role="note">
          {item.error}
        </p>
      )}
      {(item.retry || item.cancel || item.error) && (
        <div className="activity-item-actions">
          {item.error && (
            <Button
              size="small"
              variant="ghost"
              onClick={() => setShowError(!showError)}
            >
              {showError ? "收起错误" : "查看错误"}
            </Button>
          )}
          {item.cancel && action(item.cancel, false)}
          {item.retry && action(item.retry, true)}
        </div>
      )}
    </div>
  );
}

export interface ActivityViewProps {
  open: boolean;
  status: StatusViewModel;
  activity: ActivityModel;
  busy: boolean;
  error: string;
  /** Set when finished records exceed the history limit. */
  showClear: boolean;
  clearBlocked: string | undefined;
  confirmation: { name: string; destructive: boolean } | undefined;
  onClose(): void;
  onInvoke(action: ActivityAction): void;
  onClear(): void;
  onDismiss(): void;
  onConfirm(): void;
}
/** The single centre for sync state, outbound writes, transfers and background jobs. */
export function ActivityView({
  open,
  status,
  activity,
  busy,
  error,
  showClear,
  clearBlocked,
  confirmation,
  onClose,
  onInvoke,
  onClear,
  onDismiss,
  onConfirm,
}: ActivityViewProps): ReactElement {
  const [completedOpen, setCompletedOpen] = useState(true);
  const { active, attention, completed, scopes } = activity;
  const spinning =
    status.connection === "syncing" || status.connection === "connecting";
  const rows = (items: readonly ActivityItem[]) =>
    items.map((item) => (
      <ActivityRow key={item.id} item={item} busy={busy} onInvoke={onInvoke} />
    ));
  const syncing = scopes.some((scope) => scope.state !== "ready");
  // A refused build always offers the update here, also after a failed download.
  const updateNeeded =
    !!status.versionRejected && status.update.state !== "applying";
  return (
    <>
      <Sheet open={open} title="同步与任务" onClose={onClose}>
        <div className={`activity-hero status-${status.connection}`}>
          <span className="activity-hero-icon">
            <Icon
              name={connectionIcons[status.connection]}
              size={22}
              spin={spinning}
            />
          </span>
          <div>
            <strong>
              {connectionLabels[status.connection]}
              {status.connection === "syncing" &&
                ` ${status.syncingCount || 0}`}
            </strong>
            <span>上次同步 {status.lastSync}</span>
            <span>
              {status.operations.length
                ? `${status.pending} 项待同步 · ${status.failed} 项失败`
                : "所有更改已保存"}
            </span>
          </div>
        </div>
        {error && <StatePanel state="error" hint={error} />}
        {scopes.length > 0 && (
          <Group
            title="同步范围"
            hint={
              syncing
                ? `${activity.scopesReady} / ${scopes.length} 已可用，已完成的内容可以直接使用`
                : undefined
            }
          >
            {scopes.map((scope) => (
              <GroupRow
                key={scope.id}
                label={scope.title}
                hint={
                  scope.state === "loading"
                    ? `已接收 ${scope.rows} 条`
                    : undefined
                }
              >
                <span className={`activity-scope is-${scope.state}`}>
                  <Icon
                    name={
                      scope.state === "ready"
                        ? "check"
                        : scope.state === "loading"
                          ? "sync"
                          : "clock"
                    }
                    size={16}
                    spin={scope.state === "loading"}
                  />
                  {scopeStates[scope.state]}
                </span>
              </GroupRow>
            ))}
          </Group>
        )}
        {attention.length > 0 && (
          <section className="activity-section">
            <SectionHeader
              title={`需要处理 · ${attention.length}`}
              hint="失败的更改、传输和任务"
            />
            {rows(attention)}
          </section>
        )}
        {active.length > 0 && (
          <section className="activity-section">
            <SectionHeader title={`进行中 · ${active.length}`} />
            {rows(active)}
          </section>
        )}
        {!active.length && !attention.length && !completed.length && (
          <StatePanel
            state="empty"
            title="没有进行中的内容"
            hint="下载、上传、待同步的更改和后台任务会显示在这里"
          />
        )}
        {completed.length > 0 && (
          <section className="activity-section">
            <SectionHeader
              title={`最近完成 · ${completed.length}`}
              action={
                <Button
                  size="small"
                  variant="ghost"
                  aria-expanded={completedOpen}
                  onClick={() => setCompletedOpen(!completedOpen)}
                >
                  {completedOpen ? "收起" : "展开"}
                </Button>
              }
            />
            {completedOpen && rows(completed)}
            {completedOpen && showClear && (
              <div className="activity-clear">
                <Button
                  variant="ghost"
                  size="small"
                  busy={busy}
                  disabledReason={clearBlocked}
                  onClick={onClear}
                >
                  清理历史
                </Button>
              </div>
            )}
          </section>
        )}
        <Group title="本机与版本">
          <GroupRow label="存储用量">{status.storage}</GroupRow>
          <GroupRow label="当前版本">
            <span className="selectable">{status.build}</span>
          </GroupRow>
          <GroupRow
            label={
              updateNeeded ? "需要更新" : updateLabels[status.update.state]
            }
            hint={
              updateNeeded
                ? status.update.state === "failed" && status.update.message
                  ? `服务器已更新，此版本无法再连接服务器。${status.update.message}`
                  : "服务器已更新，此版本无法再连接服务器。"
                : status.update.message
            }
            stacked={status.update.state === "installing"}
          >
            {status.update.state === "installing" ? (
              <Progress label="更新进度" value={status.update.progress || 0} />
            ) : updateNeeded ? (
              <Button
                variant="primary"
                size="small"
                onClick={status.versionRejected!.updateNow}
              >
                现在更新
              </Button>
            ) : status.update.apply ? (
              <Button
                variant="primary"
                size="small"
                onClick={status.update.apply}
              >
                应用新版本
              </Button>
            ) : status.update.state === "failed" ? (
              <Icon name="error" size={18} />
            ) : undefined}
          </GroupRow>
        </Group>
      </Sheet>
      <ConfirmDialog
        open={open && !!confirmation}
        objectName={confirmation?.name ?? ""}
        destructive={!!confirmation?.destructive}
        onClose={onDismiss}
        onConfirm={onConfirm}
      />
    </>
  );
}
