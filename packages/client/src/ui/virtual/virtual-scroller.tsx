import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { Direction, EdgeView, Scroller } from "@talos/virtual";
import { DomViewport } from "@talos/virtual/dom";

export interface VirtualScrollerProps<T> {
  /** Seek keys never reach the view, so any key type renders the same. */
  scroller: Scroller<T, unknown>;
  renderItem(item: T, id: string): ReactNode;
  /** Leading and trailing slots: loaders, failures, list headers and footers. */
  renderEdge?(direction: Direction, edge: EdgeView): ReactNode;
  label: string;
  role?: "list" | "rowgroup" | "region" | "log";
  itemRole?: "listitem" | "presentation";
  className?: string;
  style?: CSSProperties;
  testId?: string;
}

const layer: CSSProperties = { position: "absolute", left: 0, right: 0 };

/**
 * Renders a scroller's window. React owns which items exist; the DOM driver owns where they
 * are (content height, layer offsets, scroll offset), so scrolling re-renders only when the
 * rendered range changes. The element must get its height from layout (flex or explicit) and
 * have no vertical padding: put spacing into items or edge slots.
 */
export function VirtualScroller<T>({
  scroller,
  renderItem,
  renderEdge,
  label,
  role = "list",
  itemRole = "listitem",
  className,
  style,
  testId = "ui.virtual-list",
}: VirtualScrollerProps<T>): ReactElement {
  const driver = useMemo(() => new DomViewport(scroller), [scroller]);
  const view = useSyncExternalStore(
    driver.subscribe,
    scroller.getSnapshot,
    scroller.getSnapshot,
  );
  const scroll = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const items = useRef<HTMLDivElement>(null);
  const before = useRef<HTMLDivElement>(null);
  const after = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    driver.attach({
      scroll: scroll.current!,
      canvas: canvas.current!,
      items: items.current!,
      before: before.current!,
      after: after.current!,
    });
    return () => driver.detach();
  }, [driver]);
  useLayoutEffect(() => driver.commit(view.items[0]?.id));
  return (
    <div
      ref={scroll}
      className={className}
      role={role}
      aria-label={label}
      aria-busy={view.status === "seeking" || undefined}
      tabIndex={0}
      data-testid={testId}
      style={{
        ...style,
        // A permanent scrollbar gutter: content that starts or stops overflowing must not
        // reflow every item (and re-trigger their size observers) by changing the width.
        overflowY: "scroll",
        overflowAnchor: "none",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <div ref={canvas} style={{ position: "relative" }}>
        <div
          ref={before}
          style={{ ...layer, top: 0 }}
          data-virtual-edge="before"
        >
          {renderEdge?.("before", view.before)}
        </div>
        <div ref={items} style={layer}>
          {view.items.map((entry) => (
            <div
              key={entry.id}
              ref={driver.ref(entry.id)}
              role={itemRole}
              data-virtual-id={entry.id}
              style={{ display: "flow-root" }}
            >
              {renderItem(entry.item, entry.id)}
            </div>
          ))}
        </div>
        <div ref={after} style={layer} data-virtual-edge="after">
          {renderEdge?.("after", view.after)}
        </div>
      </div>
    </div>
  );
}
