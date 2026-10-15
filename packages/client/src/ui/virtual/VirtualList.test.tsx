import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualList } from "./VirtualList";
import type { VirtualListHandle } from "./VirtualList";

describe("VirtualList React binding", () => {
  let container: HTMLDivElement;
  let root: Root;
  const items = Array.from({ length: 50_000 }, (_, id) => ({
    id,
    title: `项目 ${id}`,
  }));
  const getKey = (item: { id: number }): number => item.id;
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("renders a bounded, accessible window and scrolls bidirectionally through 50,000 rows", async () => {
    const ref = createRef<VirtualListHandle>();
    await act(async () =>
      root.render(
        <VirtualList
          ref={ref}
          items={items}
          getKey={getKey}
          renderItem={(item) => item.title}
          estimatedItemHeight={20}
          height={100}
          overscan={20}
          ariaLabel="阅读项目"
        />,
      ),
    );
    expect(
      container.querySelector('[role="list"]')?.getAttribute("aria-label"),
    ).toBe("阅读项目");
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(6);
    await act(async () => ref.current!.scrollToIndex(25_000, "start"));
    expect(container.textContent).toContain("项目 25000");
    expect(container.textContent).not.toContain("项目 0");
    expect(
      container
        .querySelector('[aria-posinset="25001"]')
        ?.getAttribute("aria-setsize"),
    ).toBe("50000");
    expect(container.querySelectorAll('[role="listitem"]').length).toBeLessThan(
      10,
    );
    await act(async () => ref.current!.scrollToKey(1, "start"));
    expect(container.textContent).toContain("项目 1");
  });
  it("responds to native scroll events", async () => {
    await act(async () =>
      root.render(
        <VirtualList
          items={items}
          getKey={getKey}
          renderItem={(item) => item.title}
          estimatedItemHeight={20}
          height={100}
          overscan={0}
        />,
      ),
    );
    const node = container.querySelector<HTMLElement>('[role="list"]')!;
    await act(async () => {
      node.scrollTop = 400;
      node.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(
      container
        .querySelector('[role="listitem"]')
        ?.getAttribute("aria-posinset"),
    ).toBe("21");
  });
  it("preserves the visible key after prepending and supports empty replacement", async () => {
    const ref = createRef<VirtualListHandle>();
    const render = (rows: typeof items): void =>
      root.render(
        <VirtualList
          ref={ref}
          items={rows}
          getKey={getKey}
          renderItem={(item) => item.title}
          estimatedItemHeight={20}
          height={100}
          overscan={0}
        />,
      );
    await act(async () => render(items));
    await act(async () => ref.current!.scrollToKey(20, "start"));
    await act(async () => render([{ id: -1, title: "新项目" }, ...items]));
    expect(
      container.querySelector<HTMLElement>('[role="list"]')!.scrollTop,
    ).toBe(420);
    expect(container.querySelector('[role="listitem"]')?.textContent).toBe(
      "项目 20",
    );
    await act(async () => render([]));
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(0);
  });
  it("measures manually without ResizeObserver and keeps height changes above the viewport stable", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    let tall = false;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const height = this.dataset.virtualIndex === "9" && tall ? 50 : 20;
        return {
          x: 0,
          y: 0,
          top: 0,
          bottom: height,
          left: 0,
          right: 100,
          width: 100,
          height,
          toJSON: () => ({}),
        };
      },
    );
    const ref = createRef<VirtualListHandle>();
    await act(async () =>
      root.render(
        <VirtualList
          ref={ref}
          items={items}
          getKey={getKey}
          renderItem={(item) => item.title}
          estimatedItemHeight={20}
          height={100}
          overscan={20}
        />,
      ),
    );
    await act(async () => ref.current!.scrollToIndex(10, "start"));
    tall = true;
    await act(async () => ref.current!.measure());
    expect(
      container.querySelector<HTMLElement>('[role="list"]')!.scrollTop,
    ).toBe(230);
    expect(container.querySelector('[aria-posinset="11"]')).not.toBeNull();
    await act(async () => window.dispatchEvent(new Event("resize")));
  });
  it("observes visible rows and disconnects when the range changes or unmounts", async () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const ref = createRef<VirtualListHandle>();
    await act(async () =>
      root.render(
        <VirtualList
          ref={ref}
          items={items}
          getKey={getKey}
          renderItem={(item) => item.title}
          estimatedItemHeight={20}
          height={100}
          overscan={0}
        />,
      ),
    );
    expect(observe).toHaveBeenCalled();
    await act(async () =>
      callbacks[callbacks.length - 1]!([], {} as ResizeObserver),
    );
    await act(async () => ref.current!.scrollToIndex(100));
    expect(disconnect).toHaveBeenCalled();
  });
  it("shows appended chat rows while pinned to the bottom", async () => {
    const render = (rows: typeof items): void =>
      root.render(
        <VirtualList
          items={rows}
          getKey={getKey}
          renderItem={(item) => item.title}
          estimatedItemHeight={20}
          height={100}
          overscan={0}
          stickToBottom
        />,
      );
    await act(async () => render(items.slice(0, 10)));
    expect(
      container.querySelector<HTMLElement>('[role="list"]')!.scrollTop,
    ).toBe(100);
    await act(async () => render(items.slice(0, 11)));
    expect(
      container.querySelector<HTMLElement>('[role="list"]')!.scrollTop,
    ).toBe(120);
    expect(container.textContent).toContain("项目 10");
  });

  it("corrects bottom scroll after the browser clamps a write against the old spacer", async () => {
    const render = (rows: typeof items): void =>
      root.render(
        <VirtualList
          items={rows}
          getKey={getKey}
          renderItem={(item) => item.title}
          estimatedItemHeight={20}
          height={100}
          overscan={0}
          stickToBottom
        />,
      );
    await act(async () => render(items.slice(0, 10)));
    const viewport = container.querySelector<HTMLElement>('[role="list"]')!;
    let actual = viewport.scrollTop;
    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      get: () => actual,
      set: (value: number) => {
        const spacer = viewport.firstElementChild as HTMLElement;
        actual = Math.max(
          0,
          Math.min(value, parseFloat(spacer.style.height) - 100),
        );
      },
    });
    await act(async () => render(items.slice(0, 20)));
    expect(viewport.scrollTop).toBe(300);
    expect(container.textContent).toContain("项目 19");
  });

  it("recomputes the rendered range when height changes cancel out in total size", async () => {
    let changed = false;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const index = this.dataset.virtualIndex;
        const height =
          changed && index === "2" ? 35 : changed && index === "3" ? 5 : 20;
        return {
          x: 0,
          y: 0,
          top: 0,
          bottom: height,
          left: 0,
          right: 100,
          width: 100,
          height,
          toJSON: () => ({}),
        };
      },
    );
    const ref = createRef<VirtualListHandle>();
    await act(async () =>
      root.render(
        <VirtualList
          ref={ref}
          items={items}
          getKey={getKey}
          renderItem={(item) => item.title}
          estimatedItemHeight={20}
          height={30}
          overscan={40}
        />,
      ),
    );
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(4);
    changed = true;
    await act(async () => ref.current!.measure());
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(3);
  });
});
