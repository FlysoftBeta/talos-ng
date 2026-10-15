import type { ReactElement } from "react";
import type { ReactNode } from "react";
import { Icon } from "../icon/icon.tsx";
import type { IconName } from "../icon/icon.tsx";
import "./feedback.css";

export type MarkState = "pending" | "failed" | "confirmed";
/** Inline operation state: amber clock (queued), red alert with retry (failed), green check. */
export function Mark({
  state,
  onRetry,
  label: customLabel,
}: {
  state: MarkState;
  onRetry?: () => void;
  label?: string;
}): ReactElement {
  const label =
    customLabel ||
    { pending: "待发送", failed: "发送失败", confirmed: "已确认" }[state];
  return (
    <span className={`mark mark-${state}`} data-testid="ui.mark">
      <Icon
        name={
          state === "pending" ? "clock" : state === "failed" ? "error" : "check"
        }
        size={14}
      />
      <span className="mark-label">{label}</span>
      {state === "failed" && onRetry && (
        <button type="button" className="mark-action" onClick={onRetry}>
          重试
        </button>
      )}
    </span>
  );
}
/** Small count pill (unread). Hidden at zero. */
export function Badge({
  count,
  tone = "accent",
  muted = false,
}: {
  count: number;
  tone?: "accent" | "pending" | "failed";
  muted?: boolean;
}): ReactElement | null {
  if (!count) return null;
  return (
    <span className={`badge badge-${muted ? "muted" : tone}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
/**
 * The one list row. The whole row is the tap target (a stretched button); `leading`
 * and `trailing` may hold their own controls, which sit above the stretched target.
 */
export function ListRow({
  title,
  hint,
  meta,
  leading,
  trailing,
  badge,
  mark,
  markLabel,
  selected,
  onClick,
  titleSuffix,
  className = "",
  "data-testid": testId = "ui.row",
}: {
  title: string;
  hint?: ReactNode;
  /** Small text at the top right (time, size). */
  meta?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  badge?: ReactNode;
  mark?: MarkState;
  markLabel?: string;
  selected?: boolean;
  onClick?: () => void;
  /** Small icons after the title (pinned, muted). */
  titleSuffix?: ReactNode;
  className?: string;
  "data-testid"?: string;
}): ReactElement {
  const titleNode = (
    <span className="row-title ellipsis" data-testid="ui.row.title">
      {title}
    </span>
  );
  return (
    <div
      className={`row${hint ? " row-2" : ""}${selected ? " is-selected" : ""}${onClick ? " is-action" : ""} ${className}`}
      data-testid={testId}
    >
      {leading && <span className="row-leading">{leading}</span>}
      <span className="row-copy">
        <span className="row-line">
          {onClick ? (
            <button
              type="button"
              className="row-main"
              data-testid="ui.row.action"
              aria-pressed={selected}
              onClick={onClick}
            >
              {titleNode}
            </button>
          ) : (
            titleNode
          )}
          {titleSuffix && <span className="row-suffix">{titleSuffix}</span>}
          {meta && <span className="row-meta">{meta}</span>}
        </span>
        {(hint || badge) && (
          <span className="row-line">
            {hint && (
              <span className="row-hint ellipsis" data-testid="ui.row.hint">
                {hint}
              </span>
            )}
            {badge && <span className="row-badge">{badge}</span>}
          </span>
        )}
      </span>
      {mark && (
        <span className="row-mark">
          <Mark state={mark} label={markLabel} />
        </span>
      )}
      {trailing && <span className="row-trailing">{trailing}</span>}
    </div>
  );
}
export type PanelState =
  "loading" | "empty" | "offline" | "error" | "forbidden";
const panels: Record<
  PanelState,
  { icon: IconName; title: string; hint: string }
> = {
  loading: { icon: "loading", title: "加载中", hint: "" },
  empty: { icon: "empty", title: "空", hint: "这里还没有内容" },
  offline: {
    icon: "offline",
    title: "离线未缓存",
    hint: "连接服务器后即可查看",
  },
  error: { icon: "error", title: "出错，可重试", hint: "暂时无法显示" },
  forbidden: { icon: "lock", title: "无权限", hint: "当前账号无法查看此内容" },
};
/** The five shared states of every list and viewer. Loading fades in after a delay. */
export function StatePanel({
  state,
  title,
  hint,
  action,
  compact = false,
}: {
  state: PanelState;
  title?: string;
  hint?: string;
  action?: ReactNode;
  compact?: boolean;
}): ReactElement {
  const p = panels[state];
  const text = hint === undefined ? p.hint : hint;
  return (
    <div
      className={`state-panel state-${state}${compact ? " is-compact" : ""}`}
      role={state === "error" ? "alert" : "status"}
    >
      <span className="state-icon">
        <Icon
          name={p.icon}
          size={state === "loading" ? 20 : 22}
          spin={state === "loading"}
        />
      </span>
      <h3>{title || p.title}</h3>
      {text && <p>{text}</p>}
      {action && <div className="state-action">{action}</div>}
    </div>
  );
}
export function Spinner({ size = 20 }: { size?: number }): ReactElement {
  return (
    <span className="spinner" role="status" aria-label="加载中">
      <Icon name="loading" size={size} spin />
    </span>
  );
}
export function Progress({
  value,
  label,
}: {
  /** 0..1, or undefined for indeterminate. */
  value?: number;
  label: string;
}): ReactElement {
  return (
    <span
      className={`progress${value === undefined ? " is-indeterminate" : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === undefined ? undefined : Math.round(value * 100)}
    >
      <span
        className="progress-bar"
        style={
          value === undefined
            ? undefined
            : { width: `${Math.max(0, Math.min(1, value)) * 100}%` }
        }
      />
    </span>
  );
}
/** An inline notice inside a pane or form: info, pending (amber) or failed (red). */
export function InlineNotice({
  tone = "info",
  children,
  action,
}: {
  tone?: "info" | "pending" | "failed" | "confirmed";
  children: ReactNode;
  action?: ReactNode;
}): ReactElement {
  return (
    <div
      className={`notice notice-${tone}`}
      role={tone === "failed" ? "alert" : "status"}
    >
      <Icon
        name={
          tone === "failed"
            ? "error"
            : tone === "pending"
              ? "clock"
              : tone === "confirmed"
                ? "check-circle"
                : "info"
        }
        size={18}
      />
      <div className="notice-body">{children}</div>
      {action && <div className="notice-action">{action}</div>}
    </div>
  );
}
export interface Notice {
  id: string;
  text: string;
  tone: "info" | "error" | "success";
  action?: { label: string; run: () => void };
}
/** A stack of inline notices (bulk results, transient feedback inside a pane). */
export function BannerHost({
  notices,
  onDismiss,
}: {
  notices: readonly Notice[];
  onDismiss?: (id: string) => void;
}): ReactElement {
  return (
    <div className="banner-host">
      {notices.map((n) => (
        <InlineNotice
          key={n.id}
          tone={
            n.tone === "error"
              ? "failed"
              : n.tone === "success"
                ? "confirmed"
                : "info"
          }
          action={
            <>
              {n.action && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={n.action.run}
                >
                  {n.action.label}
                </button>
              )}
              {onDismiss && (
                <button
                  type="button"
                  className="notice-close"
                  aria-label="关闭提示"
                  onClick={() => onDismiss(n.id)}
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </>
          }
        >
          {n.text}
        </InlineNotice>
      ))}
    </div>
  );
}
export function Toast({
  notice,
  onDismiss,
}: {
  notice?: Notice;
  onDismiss?: (id: string) => void;
}): ReactElement {
  return (
    <div className="toast-host is-legacy">
      <BannerHost notices={notice ? [notice] : []} onDismiss={onDismiss} />
    </div>
  );
}
