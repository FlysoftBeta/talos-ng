import type { ReactElement, ReactNode } from "react";
import { useToast } from "./toast.tsx";
/**
 * Wraps a control that cannot act right now: the control stays visible but inert and a
 * covering target explains the reason in a toast. Without a reason the children render as is.
 * Prefer `disabledReason` on Button/IconButton; this wrapper serves composite controls.
 */
export function OfflineHint({
  label,
  reason,
  children,
  block = false,
}: {
  label: string;
  reason?: string;
  children: ReactNode;
  block?: boolean;
}): ReactElement {
  const toast = useToast();
  return reason ? (
    <div className={`offline-hint${block ? " is-block" : ""}`}>
      <fieldset className="disabled-control" disabled aria-hidden="true">
        {children}
      </fieldset>
      <button
        type="button"
        className="offline-hit"
        aria-label={`${label}，${reason}`}
        title={reason}
        onClick={() => toast(reason)}
      />
    </div>
  ) : (
    <>{children}</>
  );
}
