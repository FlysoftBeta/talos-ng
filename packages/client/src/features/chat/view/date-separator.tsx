import type { ReactElement } from "react";
export function DateSeparator({ label }: { label: string }): ReactElement {
  return (
    <div className="chat-date" role="separator">
      <span>{label}</span>
    </div>
  );
}
