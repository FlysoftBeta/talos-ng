import type { ReactElement } from "react";
import { NumPad } from "./num-pad.tsx";
export function PinEntryView({
  length,
  busy,
  error,
  label,
  onKey,
}: {
  length: number;
  busy: boolean;
  error?: string;
  label: string;
  onKey: (key: string) => void;
}): ReactElement {
  return (
    <div className="pin-entry">
      <div
        className="pin-dots"
        role="status"
        aria-label={`${label}，已输入 ${length} 位，共 6 位`}
        aria-live="polite"
      >
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={i < length ? "is-filled" : ""} />
        ))}
      </div>
      <div
        className={`auth-message${error ? " is-error" : ""}`}
        role={error ? "alert" : "status"}
      >
        {error || (busy ? "正在验证…" : " ")}
      </div>
      <NumPad disabled={busy} onKey={onKey} />
    </div>
  );
}
