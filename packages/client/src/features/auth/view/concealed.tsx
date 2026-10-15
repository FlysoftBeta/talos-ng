import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import "./auth.css";
export function ConcealedView({
  onKey,
  onTouch,
  onMouse,
}: {
  /** Return true to consume the key. */
  onKey: (key: string) => boolean;
  onTouch: (x: number, y: number) => void;
  onMouse: (x: number, y: number) => void;
}): ReactElement {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    root.current?.focus();
  }, []);
  return (
    <main
      ref={root}
      className="concealed-screen"
      data-testid="auth.concealed"
      tabIndex={0}
      role="application"
      aria-label="锁定屏幕"
      onKeyDown={(event) => {
        if (onKey(event.key)) event.preventDefault();
      }}
      onTouchStart={(event) => {
        const touch = event.changedTouches[0];
        if (touch) onTouch(touch.clientX, touch.clientY);
      }}
      onMouseDown={(event) => onMouse(event.clientX, event.clientY)}
    />
  );
}
