import { useLayoutEffect, useState } from "react";
import { ArraySource, Scroller } from "@talos/virtual";
import type { ScrollerOptions, Target } from "@talos/virtual";

export interface ArrayScrollerOptions<T> extends ScrollerOptions {
  key(item: T): string;
  /** Size hint in px until the item is measured. */
  size?(item: T): number | undefined;
  /** Whether an item renders the same; default identity. */
  equals?(a: T, b: T): boolean;
  /** Where the list opens; default its start. */
  initial?: Target;
}

/**
 * A scroller over a list the caller already holds in full. Later `items` are diffed into
 * inserts, removals and updates, so the first visible item keeps its place. Options are read
 * once, on mount.
 */
export function useArrayScroller<T>(
  items: readonly T[],
  options: ArrayScrollerOptions<T>,
): Scroller<T> {
  const [{ source, scroller }] = useState(() => {
    const source = new ArraySource<T>(
      { key: options.key, size: options.size, equals: options.equals },
      items,
    );
    return { source, scroller: new Scroller<T>(source, options) };
  });
  useLayoutEffect(() => {
    void scroller.start(options.initial ?? { edge: "start" });
    return () => scroller.dispose();
  }, [scroller]);
  useLayoutEffect(() => source.set(items), [source, items]);
  return scroller;
}
