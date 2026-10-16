import type { ReactElement, ReactNode } from "react";
import { Button, IconButton } from "../../../ui/actions/index.ts";
import { ConfirmDialog, Dialog, Menu } from "../../../ui/overlays/index.ts";
import { Field, SelectField } from "../../../ui/inputs/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import { Pane, PaneBody, PaneHeader } from "../../../ui/layout/index.ts";
import { InlineNotice, StatePanel } from "../../../ui/feedback/index.ts";
import "./media.css";

/** The content pane: source header, track list, player bar footer. */
export function MediaContentView({
  title,
  count,
  actions,
  error,
  footer,
  children,
}: {
  title: string;
  /** Track count of the shown source; hidden while unknown. */
  count: number | undefined;
  actions?: ReactNode;
  error: string;
  /** The player bar while a track is loaded. */
  footer?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <Pane className="media-content" data-testid="media.content">
      <PaneHeader
        title={title}
        titleTestId="media.content.title"
        subtitle={count === undefined ? undefined : `${count} 首`}
        actions={actions}
      />
      <PaneBody className="media-tracks">
        {error && (
          <div className="media-notice">
            <InlineNotice tone="failed">{error}</InlineNotice>
          </div>
        )}
        {children}
      </PaneBody>
      {footer && <div className="pane-footer media-footer">{footer}</div>}
    </Pane>
  );
}

/** Track rows of a source, or its state when there is nothing to list. */
export function TrackListView({
  state,
  emptyTitle,
  loadingTitle = "正在同步音乐",
  emptyHint,
  error,
  onRetry,
  children,
}: {
  state: "tracks" | "loading" | "error" | "empty" | "offline";
  emptyTitle: string;
  loadingTitle?: string;
  emptyHint?: string;
  error?: string;
  onRetry?: () => void;
  /** Connected track rows. */
  children: ReactNode;
}): ReactElement {
  if (state === "tracks")
    return (
      <div className="media-track-list" role="list">
        {children}
      </div>
    );
  if (state === "loading")
    return <StatePanel compact state="loading" title={loadingTitle} />;
  if (state === "error")
    return (
      <StatePanel
        compact
        state="error"
        title={error}
        hint=""
        action={
          onRetry && (
            <Button size="small" onClick={onRetry}>
              重试
            </Button>
          )
        }
      />
    );
  return (
    <StatePanel
      compact
      state={state}
      title={emptyTitle}
      hint={state === "offline" ? undefined : emptyHint}
    />
  );
}

export interface PlaylistPanelProps {
  title: string;
  personalRetention: number | "auto";
  retentionOpen: boolean;
  onToggleRetention(): void;
  days: number | "auto";
  daysChoices: readonly (number | "auto")[];
  daysValid: boolean;
  /** Retention days may be edited. */
  editable: boolean;
  retentionReason: string | undefined;
  onDays(value: number | "auto"): void;
  onSaveDays(): void;
  shareReason: string | undefined;
  onShare(): void;
  addReason: string | undefined;
  onAdd(): void;
  /** Present for the owner only. */
  deleteReason: { reason: string | undefined } | undefined;
  onDelete(): void;
  adding:
    | {
        title: string;
        source: string;
        sources: readonly { id: string; title: string }[];
        onSource(id: string): void;
        choice: string;
        onChoice(id: string): void;
        tracks: readonly { id: string; title: string }[];
        onSubmit(): void;
        onClose(): void;
      }
    | undefined;
  removing: { name: string; onConfirm(): void; onClose(): void } | undefined;
  /** Share sheet supplied by the connection because it needs the sharing adapter. */
  share: ReactNode;
}
/** Header actions of an open playlist: share, add, retention, overflow (delete). */
export function PlaylistActionsView(p: PlaylistPanelProps): ReactElement {
  return (
    <>
      <Button
        size="small"
        variant="ghost"
        className="media-retention"
        aria-expanded={p.retentionOpen}
        aria-haspopup="dialog"
        onClick={p.onToggleRetention}
      >
        我的离线保留 ·{" "}
        {p.personalRetention === "auto" ? "自动" : `${p.personalRetention} 天`}
        <Icon name="down" size={14} />
      </Button>
      <IconButton
        label="分享"
        icon="share"
        disabledReason={p.shareReason}
        onClick={p.onShare}
      />
      <IconButton
        label="添加曲目"
        icon="plus"
        disabledReason={p.addReason}
        onClick={p.onAdd}
      />
      <Menu
        label="歌单操作"
        items={[
          {
            label: "删除歌单",
            icon: "trash",
            danger: true,
            hidden: !p.deleteReason,
            disabledReason: p.deleteReason?.reason,
            onSelect: p.onDelete,
          },
        ]}
      />
    </>
  );
}
/** Dialogs of an open playlist (retention, add tracks, delete, share). */
export function PlaylistDialogsView(p: PlaylistPanelProps): ReactElement {
  return (
    <>
      {p.retentionOpen && (
        <Dialog
          open
          size="sm"
          title="离线保留"
          subtitle={p.title}
          onClose={p.onToggleRetention}
          footer={
            <>
              <Button variant="secondary" onClick={p.onToggleRetention}>
                取消
              </Button>
              <Button
                variant="primary"
                disabled={!p.daysValid}
                disabledReason={p.retentionReason}
                onClick={p.onSaveDays}
              >
                保存设置
              </Button>
            </>
          }
        >
          <div className="media-retention-form">
            <p className="media-dialog-text">
              仅影响我的设备。自动不主动下载；选定天数后，从设置或我最近播放此歌单起保留。
            </p>
            <SelectField
              label="常用天数"
              value={String(p.days)}
              onChange={(e) =>
                p.onDays(
                  e.target.value === "auto" ? "auto" : Number(e.target.value),
                )
              }
            >
              {p.daysChoices.map((n) => (
                <option key={n} value={n}>
                  {n === "auto" ? "自动" : `${n} 天`}
                </option>
              ))}
            </SelectField>
            <Field
              label="保留天数"
              type="number"
              min={1}
              max={365}
              value={p.days === "auto" ? "" : p.days}
              hint="1–365 天；自动不主动下载"
              onChange={(event) =>
                p.onDays(
                  event.target.value ? Number(event.target.value) : "auto",
                )
              }
              error={p.daysValid ? undefined : "请输入 1–365 之间的整数"}
            />
          </div>
        </Dialog>
      )}
      {p.adding && (
        <Dialog
          open
          size="sm"
          title={p.adding.title}
          onClose={p.adding.onClose}
          footer={
            <>
              <Button variant="secondary" onClick={p.adding.onClose}>
                取消
              </Button>
              <Button
                variant="primary"
                disabled={!p.adding.choice}
                onClick={p.adding.onSubmit}
              >
                添加
              </Button>
            </>
          }
        >
          <SelectField
            label="曲目来源"
            value={p.adding.source}
            onChange={(e) => p.adding!.onSource(e.target.value)}
          >
            {p.adding.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </SelectField>
          {p.adding.tracks.length ? (
            <SelectField
              label="曲目"
              value={p.adding.choice}
              onChange={(e) => p.adding!.onChoice(e.target.value)}
            >
              <option value="">选择曲目</option>
              {p.adding.tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </SelectField>
          ) : (
            <StatePanel
              compact
              state="empty"
              title="没有可添加的曲目"
              hint="先搜索音乐，或选择有权访问的歌单"
            />
          )}
        </Dialog>
      )}
      {p.removing && (
        <ConfirmDialog
          open
          objectName={p.removing.name}
          destructive
          confirmLabel="确认删除"
          message="移除歌单后，没有其他歌单引用的曲目会在服务器设定的回收期限后删除。收藏和队列不会延长保留时间。"
          onConfirm={p.removing.onConfirm}
          onClose={p.removing.onClose}
        />
      )}
      {p.share}
    </>
  );
}
