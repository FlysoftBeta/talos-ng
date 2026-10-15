import { useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Portal } from "./layers.tsx";
import { useFloating } from "./use-floating.ts";

/** Bind to the control itself: no layout wrapper and no clipped pseudo-element. */
export function useTooltip(text: string): {
  ref: React.RefObject<HTMLButtonElement | null>;
  props: {
    "aria-describedby": string | undefined;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
    onMouseDown: () => void;
  };
  tooltip: ReactElement | null;
} {
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null),
    surface = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useFloating({
    open,
    anchor: ref,
    surface,
    onClose: () => setOpen(false),
    align: "center",
    escapeBubbles: true,
  });
  return {
    ref,
    props: {
      "aria-describedby": open ? id : undefined,
      onMouseEnter: () => setOpen(true),
      onMouseLeave: () => setOpen(false),
      onFocus: () => setOpen(true),
      onBlur: () => setOpen(false),
      onMouseDown: () => setOpen(false),
    },
    tooltip: open ? (
      <Portal>
        <div
          id={id}
          ref={surface}
          role="tooltip"
          className="floating-surface floating-tooltip"
        >
          {text}
        </div>
      </Portal>
    ) : null,
  };
}
