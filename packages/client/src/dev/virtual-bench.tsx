import { useLayoutEffect, useState } from "react";
import type { ReactElement } from "react";
import { ArraySource, Scroller } from "@talos/virtual";
import type { Request, Source, SourceEvent } from "@talos/virtual";
import { VirtualScroller } from "../ui/virtual/index.ts";

/**
 * Browser test bench for the virtual scroller (gallery `?virtual`, `&end` for a list that
 * follows its end). Items have uneven heights and change size from script; the source
 * answers 40 ms late. `window.__bench` drives it from end-to-end scenarios.
 */
interface Item {
  id: string;
  n: number;
  text: string;
}
const make = (n: number): Item => ({
  id: `v${n}`,
  n,
  text: `第 ${n} 项 ` + "长短不一的内容。".repeat(1 + ((n * 7) % 9)),
});
class LateSource implements Source<Item, never> {
  constructor(readonly inner: ArraySource<Item>) {}
  connect(emit: (event: SourceEvent<Item>) => void): () => void {
    return this.inner.connect(emit);
  }
  request(request: Request<never>): void {
    setTimeout(() => this.inner.request(request), 40);
  }
}
/** Heights set from script, in px; animated one frame at a time. */
const heights = new Map<string, number>();
export function VirtualBench({ end }: { end: boolean }): ReactElement {
  const [{ source, scroller }] = useState(() => {
    const list = Array.from({ length: 2000 }, (_, n) => make(n));
    const inner = new ArraySource<Item>(
      { key: (item) => item.id, page: 30 },
      list,
    );
    return {
      source: inner,
      scroller: new Scroller<Item>(new LateSource(inner), {
        estimate: 60,
        overscan: 200,
        stickToEnd: end,
      }),
    };
  });
  const [, render] = useState(0);
  useLayoutEffect(() => {
    void scroller.start(end ? { edge: "end" } : { id: "v1000" });
    const bench = {
      scroller,
      /** Animates an item to `to` px over `frames` frames. */
      resize(id: string, to: number, frames = 20): Promise<void> {
        const element = document.querySelector<HTMLElement>(
          `[data-bench-item="${id}"]`,
        );
        const from = element ? element.getBoundingClientRect().height : to;
        return new Promise((resolve) => {
          let frame = 0;
          const step = () => {
            frame++;
            heights.set(id, from + ((to - from) * frame) / frames);
            render((value) => value + 1);
            if (frame < frames) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        });
      },
      append(count: number): void {
        const list = source.list;
        const last = list[list.length - 1]!.n;
        source.set([
          ...list,
          ...Array.from({ length: count }, (_, i) => make(last + 1 + i)),
        ]);
      },
    };
    (window as unknown as { __bench: typeof bench }).__bench = bench;
  }, [scroller, source, end]);
  return (
    <div className="talos" data-testid="dev.virtual-bench">
      <VirtualScroller
        scroller={scroller}
        label="测试列表"
        style={{ height: 480, width: 360, border: "1px solid #ccc" }}
        renderEdge={(direction, edge) => (
          <div
            data-testid={`dev.virtual-bench.${direction}`}
            style={{ padding: 8, minHeight: 4 }}
          >
            {edge.state === "loading" ? "加载中" : null}
          </div>
        )}
        renderItem={(item) => (
          <div
            data-bench-item={item.id}
            style={{
              boxSizing: "border-box",
              padding: "8px 12px",
              borderBottom: "1px solid #eee",
              overflow: "hidden",
              ...(heights.has(item.id) ? { height: heights.get(item.id) } : {}),
            }}
          >
            {item.text}
          </div>
        )}
      />
    </div>
  );
}
