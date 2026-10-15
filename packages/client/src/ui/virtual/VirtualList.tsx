import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { CSSProperties, ReactElement, ReactNode, Ref } from "react";
import { VirtualListCore } from "./core";
import type { Alignment, VirtualKey } from "./core";

export interface VirtualListHandle {
  scrollToIndex(index: number, alignment?: Alignment): void;
  scrollToKey(key: VirtualKey, alignment?: Alignment): void;
  /** Re-measure visible rows when ResizeObserver is unavailable. */
  measure(): void;
}
export interface VirtualListProps<T> {
  items: readonly T[];
  getKey(item: NoInfer<T>, index: number): VirtualKey;
  renderItem(item: NoInfer<T>, index: number): ReactNode;
  height: number;
  estimatedItemHeight?: number;
  overscan?: number;
  stickToBottom?: boolean;
  ariaLabel?: string;
  role?: "list" | "rowgroup";
  itemRole?: "listitem" | "presentation";
  className?: string;
  style?: CSSProperties;
}

function VirtualListBinding<T>(
  props: VirtualListProps<T>,
  ref: Ref<VirtualListHandle>,
): ReactElement {
  const {
    items,
    getKey,
    renderItem,
    height,
    estimatedItemHeight = 44,
    overscan = 240,
    stickToBottom = false,
  } = props;
  const core = useMemo(
    () => new VirtualListCore({ estimatedItemHeight, overscan, stickToBottom }),
    [estimatedItemHeight, overscan, stickToBottom],
  );
  const viewport = useRef<HTMLDivElement>(null);
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const keys = useMemo(() => items.map(getKey), [items, getKey]);
  const syncScroll = useCallback(() => {
    const node = viewport.current;
    if (node && Math.abs(node.scrollTop - core.offset) > 0.1)
      node.scrollTop = core.offset;
  }, [core]);
  const measure = useCallback(() => {
    const node = viewport.current;
    if (!node) return;
    // Batch reads before updating heights/scrollTop to avoid read-write layout thrashing.
    const readings = Array.from(
      node.querySelectorAll<HTMLElement>("[data-virtual-index]"),
    ).map((row) => ({
      index: Number(row.dataset.virtualIndex),
      height: row.getBoundingClientRect().height,
    }));
    let changed = false;
    readings.forEach((reading) => {
      if (reading.height > 0 && reading.index < core.count)
        if (core.sizeOf(reading.index) !== reading.height) {
          changed = true;
          core.measure(reading.index, reading.height);
        }
    });
    syncScroll();
    if (changed) refresh();
  }, [core, syncScroll]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(index, alignment) {
        core.scrollToIndex(index, alignment);
        syncScroll();
        refresh();
      },
      scrollToKey(key, alignment) {
        core.scrollToKey(key, alignment);
        syncScroll();
        refresh();
      },
      measure,
    }),
    [core, syncScroll, measure],
  );

  useLayoutEffect(() => {
    core.setItems(keys);
    core.setViewport(core.offset, height);
    syncScroll();
    refresh();
  }, [core, keys, height, syncScroll]);

  const range = core.range();
  useLayoutEffect(() => {
    measure();
    const node = viewport.current;
    if (!node) return;
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    node
      .querySelectorAll("[data-virtual-index]")
      .forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [measure, range.start, range.end, items]);

  const rows: ReactNode[] = [];
  for (
    let index = range.start;
    index < Math.min(items.length, range.end);
    index++
  ) {
    const item = items[index]!;
    const key = getKey(item, index);
    rows.push(
      <div
        key={`${typeof key}:${key}`}
        role={props.itemRole ?? "listitem"}
        aria-posinset={
          props.itemRole === "presentation" ? undefined : index + 1
        }
        aria-setsize={
          props.itemRole === "presentation" ? undefined : items.length
        }
        data-virtual-index={index}
        style={{ display: "flow-root" }}
      >
        {renderItem(item, index)}
      </div>,
    );
  }
  return (
    <div
      ref={viewport}
      data-testid="ui.virtual-list"
      role={props.role ?? "list"}
      aria-label={props.ariaLabel ?? "列表"}
      tabIndex={0}
      className={props.className}
      style={{
        ...props.style,
        height,
        overflowY: "auto",
        overflowAnchor: "none",
        position: "relative",
      }}
      onScroll={(event) => {
        core.setViewport(Math.max(0, event.currentTarget.scrollTop), height);
        refresh();
      }}
    >
      <div style={{ height: range.total, position: "relative" }}>
        <div
          style={{ position: "absolute", top: range.top, left: 0, right: 0 }}
        >
          {rows}
        </div>
      </div>
    </div>
  );
}

export const VirtualList = forwardRef(VirtualListBinding) as <T>(
  props: VirtualListProps<T> & { ref?: Ref<VirtualListHandle> },
) => ReactElement;
