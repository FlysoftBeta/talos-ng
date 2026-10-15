import type { ReactElement, ReactNode } from "react";
import { Button, IconButton } from "../../../ui/actions/index.ts";
import { ConfirmDialog, Dialog, Menu } from "../../../ui/overlays/index.ts";
import { Field, SelectField } from "../../../ui/inputs/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import { Pane, PaneBody, PaneHeader } from "../../../ui/layout/index.ts";
import { Segmented } from "../../../ui/navigation/index.ts";
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
  emptyHint,
  error,
  onRetry,
  children,
}: {
  state: "tracks" | "loading" | "error" | "empty" | "offline";
  emptyTitle: string;
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
    return <StatePanel compact state="loading" title="正在搜索音乐" />;
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
  retentionDays: number;
  retentionOpen: boolean;
  onToggleRetention(): void;
  days: number;
  daysChoices: readonly number[];
  daysValid: boolean;
  /** Retention days may be edited. */
  editable: boolean;
  retentionReason: string | undefined;
  onDays(value: number): void;
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
        离线保留 · {p.retentionDays} 天
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
                保存天数
              </Button>
            </>
          }
        >
          <div className="media-retention-form">
            <p className="media-dialog-text">
              歌单的音乐保存在本机，可离线播放；最后一次播放后再保留所选天数。
            </p>
            <Segmented
              label="常用天数"
              block
              value={String(p.days)}
              disabled={!p.editable}
              options={p.daysChoices.map((n) => ({
                value: String(n),
                label: `${n} 天`,
              }))}
              onChange={(value) => p.onDays(Number(value))}
            />
            <Field
              label="保留天数"
              type="number"
              min={1}
              max={365}
              value={p.days}
              disabled={!p.editable}
              hint="1–365 天"
              error={p.daysValid ? undefined : "请输入 1–365 之间的整数"}
              onChange={(e) => p.onDays(Number(e.target.value))}
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
              hint="搜索或播放过的曲目可以加入歌单"
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
          message="歌单中的曲目会保留，仍可在最近、收藏和搜索中找到。"
          onConfirm={p.removing.onConfirm}
          onClose={p.removing.onClose}
        />
      )}
      {p.share}
    </>
  );
}
