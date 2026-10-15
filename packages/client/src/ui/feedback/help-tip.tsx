import type { ReactElement } from "react";
import { useState } from "react";
import { Icon } from "../icon/icon.tsx";
export function HelpTip({ text }: { text: string }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <span className="help-tip">
      <button
        type="button"
        aria-label="详细说明"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onBlur={() => setOpen(false)}
      >
        <Icon name="info" size={16} />
      </button>
      {open && (
        <span className="help-tip-content" role="status">
          {text}
        </span>
      )}
    </span>
  );
}
