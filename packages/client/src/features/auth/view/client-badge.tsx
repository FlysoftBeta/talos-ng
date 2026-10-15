import type { ReactElement } from "react";
export function ClientBadge({ device }: { device?: string }): ReactElement {
  return (
    <p className="client-badge">
      设备 ID <code className="selectable">{device || "等待设备登记"}</code>
    </p>
  );
}
