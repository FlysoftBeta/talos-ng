import type { ReactElement } from "react";
import { useId, useRef, useState } from "react";
import { Portal } from "../floating/layers.tsx";
import { useFloating } from "../floating/use-floating.ts";
import { Icon } from "../icon/icon.tsx";
export function HelpTip({ text }: { text: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null),
    surface = useRef<HTMLSpanElement>(null);
  useFloating({ open, anchor, surface, onClose: () => setOpen(false) });
  return (
    <span className="help-tip">
      <button
        ref={anchor}
        aria-describedby={open ? id : undefined}
        type="button"
        aria-label="详细说明"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onBlur={() => setOpen(false)}
      >
        <Icon name="info" size={16} />
      </button>
      {open && (
        <Portal>
          <span
            id={id}
            ref={surface}
            className="help-tip-content floating-surface"
            role="tooltip"
          >
            {text}
          </span>
        </Portal>
      )}
    </span>
  );
}
