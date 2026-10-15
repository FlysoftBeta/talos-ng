import type { ReactElement } from "react";
import { createContext, useContext } from "react";
import type { ReactNode, CSSProperties, HTMLAttributes } from "react";
import { Icon } from "../icon/icon.tsx";
import "./layout.css";

export interface LayoutProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}
/** Vertical rhythm by margins (no flex gap on Chrome 70). `space` is a step of the scale. */
export function Stack({
  children,
  className = "",
  style,
  space = 4,
  "data-testid": testId,
}: LayoutProps & { space?: 1 | 2 | 3 | 4 | 5 | 6 }): ReactElement {
  return (
    <div
      className={`stack stack-${space} ${className}`}
      style={style}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
/** A horizontal run of items with even spacing; wraps when it must. */
export function Inline({
  children,
  className = "",
  style,
  "data-testid": testId,
}: LayoutProps): ReactElement {
  return (
    <div className={`inline ${className}`} style={style} data-testid={testId}>
      {children}
    </div>
  );
}
export function Pane({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement>): ReactElement {
  return (
    <section className={`pane ${className}`} {...props}>
      {children}
    </section>
  );
}

interface FrameContextValue {
  /** The list pane is hidden (focus mode); stacked narrow windows use the CSS-only back. */
  canGoBack: boolean;
  back: () => void;
}
const FrameContext = createContext<FrameContextValue>({
  canGoBack: false,
  back: () => {},
});
/** True inside the frame's content pane (not in the list pane or an overlay). */
const ContentContext = createContext(false);
/**
 * Rail · list pane · content pane. `listKind` picks one of the two list widths;
 * `focus` hides the list (immersive reading, practice); `detail` tells a narrow, stacked
 * window to show the content pane instead of the list.
 */
export function AppFrame({
  rail,
  list,
  children,
  listKind = "collection",
  focus = false,
  detail = false,
  onBack,
}: {
  rail: ReactNode;
  list: ReactNode;
  children: ReactNode;
  listKind?: "collection" | "nav";
  focus?: boolean;
  detail?: boolean;
  onBack?: () => void;
}): ReactElement {
  return (
    <FrameContext.Provider
      value={{ canGoBack: focus, back: onBack || (() => {}) }}
    >
      <div
        className={`frame frame-${listKind}${focus ? " is-focus" : ""}${detail ? " has-detail" : ""}`}
      >
        <div className="frame-rail">{rail}</div>
        <aside className="frame-list">{list}</aside>
        <main className="frame-content">
          <ContentContext.Provider value>{children}</ContentContext.Provider>
        </main>
      </div>
    </FrameContext.Provider>
  );
}
/**
 * The 56 px header of a pane. In the content pane it shows the frame's back control
 * when the list is hidden (focus mode, stacked window) or when the caller passes `onBack`.
 */
export function PaneHeader({
  title,
  subtitle,
  leading,
  actions,
  onBack,
  backLabel = "返回",
  className = "",
  titleId,
  "data-testid": testId,
  titleTestId,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  className?: string;
  titleId?: string;
  "data-testid"?: string;
  titleTestId?: string;
}): ReactElement {
  const frame = useContext(FrameContext);
  const inContent = useContext(ContentContext);
  const back =
    onBack || (inContent && frame.canGoBack ? frame.back : undefined);
  return (
    <header className={`pane-header ${className}`} data-testid={testId}>
      {back ? (
        <button
          type="button"
          className="pane-back"
          aria-label={backLabel}
          title={backLabel}
          data-testid="ui.frame.back"
          onClick={back}
        >
          <Icon name="back" />
        </button>
      ) : (
        inContent && (
          <button
            type="button"
            className="pane-back stacked-only"
            aria-label="返回列表"
            data-testid="ui.frame.back"
            onClick={frame.back}
          >
            <Icon name="back" />
          </button>
        )
      )}
      {leading}
      <div className="pane-title">
        {title !== undefined && (
          <h2 className="ellipsis" id={titleId} data-testid={titleTestId}>
            {title}
          </h2>
        )}
        {subtitle && <span className="pane-subtitle ellipsis">{subtitle}</span>}
      </div>
      {actions && <div className="pane-actions">{actions}</div>}
    </header>
  );
}
/** Older name of the pane header row; children are laid out as title + actions. */
export function Toolbar({
  children,
  className = "",
}: LayoutProps): ReactElement {
  return <div className={`pane-header toolbar ${className}`}>{children}</div>;
}
/** A tools row under a list header: search, segmented switch. */
export function PaneTools({
  children,
  className = "",
}: LayoutProps): ReactElement {
  return <div className={`pane-tools ${className}`}>{children}</div>;
}
export function CompactToolbar({
  children,
  className = "",
}: LayoutProps): ReactElement {
  return <div className={`pane-tools ${className}`}>{children}</div>;
}
/** Scrolling body of a pane; `padded` applies the pane gutter. */
export function PaneBody({
  children,
  className = "",
  padded = false,
  narrow = false,
  "data-testid": testId,
}: LayoutProps & { padded?: boolean; narrow?: boolean }): ReactElement {
  return (
    <div
      className={`pane-body scroll${padded ? " is-padded" : ""} ${className}`}
      data-testid={testId}
    >
      {narrow ? <div className="pane-column">{children}</div> : children}
    </div>
  );
}
export function SectionHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}): ReactElement {
  return (
    <header className="section-header">
      <div className="section-header-copy">
        <h3>{title}</h3>
        {hint && <p>{hint}</p>}
      </div>
      {action && <div className="section-header-action">{action}</div>}
    </header>
  );
}
/** Inset grouped list (settings style): rows separated by hairlines inside one surface. */
export function Group({
  title,
  hint,
  action,
  children,
  className = "",
  "data-testid": testId,
}: LayoutProps & {
  title?: string;
  hint?: string;
  action?: ReactNode;
}): ReactElement {
  return (
    <section className={`group ${className}`} data-testid={testId}>
      {title && <SectionHeader title={title} hint={hint} action={action} />}
      <div className="group-surface">{children}</div>
    </section>
  );
}
/** A row of a Group: label (and hint) on the left, a control or value on the right. */
export function GroupRow({
  label,
  hint,
  children,
  stacked = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  /** Put the control under the label (wide controls). */
  stacked?: boolean;
}): ReactElement {
  return (
    <div className={`group-row${stacked ? " is-stacked" : ""}`}>
      <div className="group-row-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      {children !== undefined && (
        <div className="group-row-control">{children}</div>
      )}
    </div>
  );
}
export function KeyValue({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="key-value" data-testid="ui.keyvalue">
      <span className="key-value-label" data-testid="ui.keyvalue.label">
        {label}
      </span>
      <span className="key-value-value" data-testid="ui.keyvalue.value">
        {children}
      </span>
    </div>
  );
}
export function Tag({
  children,
  tone,
  className = "",
}: LayoutProps & {
  tone?: "accent" | "pending" | "failed" | "confirmed";
}): ReactElement {
  return (
    <span className={`tag${tone ? ` tag-${tone}` : ""} ${className}`}>
      {children}
    </span>
  );
}
const avatarHues = [212, 262, 330, 22, 150, 190, 45, 290];
/** Initial on a tinted square; the hue is stable per name. */
export function Avatar({
  name,
  size = 36,
  icon,
}: {
  name: string;
  size?: 24 | 32 | 36 | 40;
  icon?: ReactNode;
}): ReactElement {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = avatarHues[Math.abs(hash) % avatarHues.length]!;
  return (
    <span
      className={`avatar avatar-${size}`}
      aria-hidden="true"
      style={
        {
          "--avatar-hue": String(hue),
        } as CSSProperties
      }
    >
      {icon || Array.from(name.trim())[0] || "?"}
    </span>
  );
}
/** The neutral content pane shown when nothing is selected: a faint mark and one hint. */
export function EmptyPane({
  icon,
  hint,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  hint?: string;
}): ReactElement {
  return (
    <div className="empty-pane">
      <span className="empty-pane-mark">
        <Icon name={icon} size={32} />
      </span>
      {hint && <p>{hint}</p>}
    </div>
  );
}
