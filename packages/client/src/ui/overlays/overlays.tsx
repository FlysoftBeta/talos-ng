import type { ReactElement } from "react";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button, IconButton } from "../actions/button.tsx";
import "./overlays.css";
import { FloatingLayer, Portal } from "../floating/layers.tsx";
export interface OverlayProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  dismissible?: boolean;
  /** Required workflows may escape to the lock screen without acknowledging. */
  onEscape?: () => void;
  /** Sticky action row at the bottom (dialog actions, sheet save). */
  footer?: ReactNode;
  /** Dialog width: sm 400, md 520 (default), lg 720, xl 960. */
  size?: "sm" | "md" | "lg" | "xl";
  /** Secondary line under the title. */
  subtitle?: ReactNode;
  /** Header actions left of the close control. */
  actions?: ReactNode;
  "data-testid"?: string;
}
const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]';
function Overlay({
  open,
  title,
  children,
  onClose,
  sheet = false,
  dismissible = true,
  onEscape,
  footer,
  size = "md",
  subtitle,
  actions,
  "data-testid": testId,
}: OverlayProps & { sheet?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState<HTMLDivElement | null>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onEscape ?? (dismissible ? onClose : () => {});
  useEffect(() => {
    if (!open) return;
    const prior =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    const node = root.current;
    if (!node) return;
    node.focus();
    const focusables = () =>
      Array.from(node?.querySelectorAll<HTMLElement>(FOCUSABLE) || []).filter(
        (element) =>
          element.tabIndex >= 0 &&
          !element.closest('[hidden], [aria-hidden="true"]') &&
          getComputedStyle(element).visibility !== "hidden" &&
          getComputedStyle(element).display !== "none",
      );
    const key = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll(
        '[role="dialog"][aria-modal="true"]',
      );
      if (dialogs[dialogs.length - 1] !== node) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
      }
      if (event.key === "Tab") {
        const items = focusables();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === node)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || document.activeElement === node)
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const containFocus = (event: FocusEvent) => {
      const dialogs = document.querySelectorAll(
        '[role="dialog"][aria-modal="true"]',
      );
      if (
        dialogs[dialogs.length - 1] === node &&
        event.target instanceof Node &&
        !node?.contains(event.target)
      )
        node?.focus();
    };
    document.addEventListener("focusin", containFocus);
    node?.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("focusin", containFocus);
      node?.removeEventListener("keydown", key);
      prior?.focus();
    };
  }, [open, dismissible, floating]);
  if (!open) return null;
  return (
    <Portal modal>
      <FloatingLayer.Provider value={floating}>
        <div
          ref={root}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          data-testid={testId}
          className={`overlay-backdrop ${sheet ? "is-sheet" : "is-dialog"}`}
          onMouseDown={(e) => {
            if (dismissible && e.target === e.currentTarget) onClose();
          }}
        >
          <div
            className={`overlay-surface ${sheet ? "sheet" : `dialog dialog-${size}`}`}
          >
            <header className="overlay-header">
              <div className="overlay-title">
                <h2 id={titleId} className="ellipsis">
                  {title}
                </h2>
                {subtitle && <p className="ellipsis">{subtitle}</p>}
              </div>
              {actions && <div className="overlay-actions">{actions}</div>}
              {dismissible && (
                <IconButton label="关闭" icon="close" onClick={onClose} />
              )}
            </header>
            <div className="overlay-body scroll">{children}</div>
            {footer && <footer className="overlay-footer">{footer}</footer>}
          </div>
          <div ref={setFloating} className="modal-floating" />
        </div>
      </FloatingLayer.Provider>
    </Portal>
  );
}
/** Side panel from the right: settings, status, tasks, details, one-record editors. */
export function Sheet(props: OverlayProps): ReactElement {
  return <Overlay {...props} sheet />;
}
/** Centred: confirmations and short forms. */
export function Dialog(props: OverlayProps): ReactElement {
  return <Overlay {...props} />;
}
/** Bottom-right action row: cancel first, the primary action last. */
export function DialogActions({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return <div className="dialog-actions">{children}</div>;
}
export function ConfirmDialog({
  open,
  objectName,
  onConfirm,
  onClose,
  destructive = false,
  title,
  message,
  confirmLabel,
  busy = false,
}: {
  open: boolean;
  objectName: string;
  onConfirm: () => void;
  onClose: () => void;
  destructive?: boolean;
  title?: string;
  message?: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
}): ReactElement {
  return (
    <Dialog
      open={open}
      size="sm"
      title={
        title ||
        (destructive ? `删除「${objectName}」？` : `确认「${objectName}」？`)
      }
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            busy={busy}
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
          >
            {confirmLabel || (destructive ? "确认删除" : "确认")}
          </Button>
        </>
      }
    >
      <p className="confirm-text">
        {message ||
          (destructive
            ? "删除后无法恢复。请确认要操作的内容。"
            : "确认后将保存此操作。")}
      </p>
    </Dialog>
  );
}
