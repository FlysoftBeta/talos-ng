import type { Geometry, Reading } from "../core/scroller.ts";
import { observeFallback } from "./fallback.ts";

/** The part of a `Scroller` the DOM side talks to. */
export interface ScrollerSurface {
  sense(reading: Reading): void;
  release(): void;
  placing(): boolean;
  geometry(): Geometry;
  offsetOf(id: string): number | undefined;
  observe(listener: () => void): () => void;
  subscribe(listener: () => void): () => void;
}
export interface ViewportParts {
  /** The scrolling element. It must not have vertical padding. */
  readonly scroll: HTMLElement;
  /** Sized to the content height; positioning context of the three layers. */
  readonly canvas: HTMLElement;
  /** Absolutely positioned; holds the rendered items in normal flow. */
  readonly items: HTMLElement;
  /** Absolutely positioned leading and trailing edge slots. */
  readonly before: HTMLElement;
  readonly after: HTMLElement;
}

const RELEASE = ["wheel", "touchstart", "pointerdown", "mousedown", "keydown"];
/** Browser timers can be replaced by a deterministic scheduler in a host binding. */
export interface ViewportTimers {
  setTimeout(callback: () => void, milliseconds: number): number;
  clearTimeout(handle: number): void;
}
const px = (
  element: HTMLElement,
  property: "height" | "top",
  value: number,
) => {
  const text = `${value}px`;
  if (element.style[property] !== text) element.style[property] = text;
};

/**
 * Binds a scroller to real elements: measures rendered items and edge slots, reports user
 * scrolling as a delta, and writes the content height, layer positions and scroll offset.
 *
 * Items flow inside one positioned layer, so a size change moves the items below it before
 * any script runs; the observer callback then restores the anchor before paint. Render
 * notifications raised inside that callback wait for the next frame: mounting items while
 * the observer is delivering would change observed sizes it already reported.
 */
export class DomViewport {
  private parts: ViewportParts | undefined;
  private readonly elements = new Map<string, HTMLElement>();
  private readonly refs = new Map<
    string,
    (element: HTMLElement | null) => void
  >();
  private observer: ResizeObserver | undefined;
  private cleanups: Array<() => void> = [];
  private first: string | undefined;
  private known = 0;
  private hidden = false;
  private observing = false;
  private writing = false;
  private frame = 0;
  private active = false;
  private touching = false;
  private idle: number | undefined;
  private readonly deferred = new Set<() => void>();

  constructor(
    private readonly scroller: ScrollerSurface,
    private readonly timers: ViewportTimers = {
      setTimeout: (callback, milliseconds) =>
        window.setTimeout(callback, milliseconds),
      clearTimeout: (handle) => window.clearTimeout(handle),
    },
  ) {}

  /** Render subscription for the binding: like the scroller's, but never inside an observer callback. */
  subscribe = (listener: () => void): (() => void) => {
    const stop = this.scroller.subscribe(() => {
      if (!this.observing) return listener();
      this.deferred.add(listener);
      if (!this.frame)
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          const listeners = Array.from(this.deferred);
          this.deferred.clear();
          listeners.forEach((deferred) => deferred());
        });
    });
    return () => {
      this.deferred.delete(listener);
      stop();
    };
  };
  /** Stable ref callback for the element rendering `id`. */
  ref(id: string): (element: HTMLElement | null) => void {
    let ref = this.refs.get(id);
    if (!ref) {
      ref = (element) => this.track(id, element);
      this.refs.set(id, ref);
    }
    return ref;
  }
  attach(parts: ViewportParts): void {
    this.detach();
    this.parts = parts;
    const { scroll } = parts;
    this.known = scroll.scrollTop;
    const scrolled = (): void => this.scrolled();
    const release = (): void => this.scroller.release();
    const activity = (): void => this.activity();
    const touchStart = (): void => {
      this.touching = true;
      this.activity();
    };
    const touchEnd = (): void => {
      this.touching = false;
      this.activity();
    };
    scroll.addEventListener("wheel", activity, { passive: true });
    scroll.addEventListener("touchstart", touchStart, { passive: true });
    scroll.addEventListener("touchend", touchEnd, { passive: true });
    scroll.addEventListener("touchcancel", touchEnd, { passive: true });
    this.cleanups.push(() => {
      scroll.removeEventListener("wheel", activity);
      scroll.removeEventListener("touchstart", touchStart);
      scroll.removeEventListener("touchend", touchEnd);
      scroll.removeEventListener("touchcancel", touchEnd);
    });
    const sync = (): void => {
      this.observing = true;
      try {
        this.sync();
      } finally {
        this.observing = false;
      }
    };
    scroll.addEventListener("scroll", scrolled);
    RELEASE.forEach((type) =>
      scroll.addEventListener(type, release, { passive: true }),
    );
    this.cleanups.push(() => {
      scroll.removeEventListener("scroll", scrolled);
      RELEASE.forEach((type) => scroll.removeEventListener(type, release));
    });
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(sync);
      this.observer = observer;
      [scroll, parts.before, parts.after, ...this.elements.values()].forEach(
        (element) => observer.observe(element),
      );
      this.cleanups.push(() => observer.disconnect());
    } else {
      this.cleanups.push(
        observeFallback(
          scroll,
          [parts.canvas, parts.items, parts.before, parts.after],
          sync,
        ),
      );
    }
    this.cleanups.push(this.scroller.observe(() => this.write()));
    this.sync();
  }
  detach(): void {
    if (this.idle !== undefined) this.timers.clearTimeout(this.idle);
    this.idle = undefined;
    this.active = false;
    this.touching = false;
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];
    this.observer = undefined;
    this.parts = undefined;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.deferred.clear();
  }
  /** After the binding rendered a range starting at `first`: measure and place it. */
  commit(first: string | undefined): void {
    this.first = first;
    this.sync();
  }
  /** Reads every fact, hands them to the scroller in one step, then writes the result. */
  sync(): void {
    const parts = this.parts;
    if (!parts) return;
    const { scroll } = parts;
    // A hidden viewport measures as zero everywhere; keep the last known layout.
    if (!this.visible(scroll)) return;
    const sizes: Array<[string, number]> = [];
    this.elements.forEach((element, id) =>
      sizes.push([id, element.getBoundingClientRect().height]),
    );
    const top = scroll.scrollTop;
    if (this.hidden || this.clamped(scroll)) {
      this.hidden = false;
      this.known = top;
    }
    const delta = top - this.known;
    const moved = Math.abs(delta) >= 0.5;
    if (moved) this.known = top;
    this.scroller.sense({
      viewport: scroll.clientHeight,
      width: scroll.clientWidth,
      ...(moved ? { scrolledBy: delta } : {}),
      sizes,
      before: parts.before.getBoundingClientRect().height,
      after: parts.after.getBoundingClientRect().height,
    });
    this.write();
  }

  private track(id: string, element: HTMLElement | null): void {
    const previous = this.elements.get(id);
    if (previous === element) return;
    if (previous) {
      this.observer?.unobserve(previous);
      this.elements.delete(id);
    }
    if (element) {
      this.elements.set(id, element);
      this.observer?.observe(element);
    } else this.refs.delete(id);
  }
  /** Keep native wheel smoothing / touch momentum alive through size corrections. */
  private activity(): void {
    this.active = true;
    if (this.idle !== undefined) this.timers.clearTimeout(this.idle);
    this.idle = this.timers.setTimeout(() => {
      this.idle = undefined;
      if (this.touching) return;
      this.active = false;
      this.write();
    }, 160);
  }
  private visible(scroll: HTMLElement): boolean {
    if (scroll.getClientRects().length) return true;
    this.hidden = true;
    return false;
  }
  /** Layout can clamp the browser offset before its resize notification arrives. */
  private clamped(scroll: HTMLElement): boolean {
    return (
      this.known > Math.max(0, scroll.scrollHeight - scroll.clientHeight) + 0.5
    );
  }
  private scrolled(): void {
    const scroll = this.parts?.scroll;
    if (!scroll || !this.visible(scroll)) return;
    if (this.hidden || this.clamped(scroll)) return this.sync();
    const top = scroll.scrollTop;
    const delta = top - this.known;
    if (Math.abs(delta) < 0.5) return;
    this.known = top;
    if (this.active) this.activity();
    this.scroller.sense({ scrolledBy: delta });
  }
  private write(): void {
    const parts = this.parts;
    if (!parts || this.writing) return;
    this.writing = true;
    try {
      const { scroll } = parts;
      if (!this.visible(scroll)) return;
      // A user scroll not yet reported must reach the scroller before it is overwritten.
      if (Math.abs(scroll.scrollTop - this.known) >= 0.5) this.scrolled();
      const geometry = this.scroller.geometry();
      // Writing scrollTop during a native smooth scroll cancels the remaining input
      // on Chromium 70. Until the gesture settles, translate the layers by the anchor
      // correction instead. Rebase the native offset and layers together afterwards.
      const bias =
        this.active && !this.scroller.placing() ? geometry.top - this.known : 0;
      px(
        parts.canvas,
        "height",
        Math.max(
          geometry.height - bias,
          bias ? this.known + geometry.viewport : 0,
        ),
      );
      px(parts.before, "top", -bias);
      px(parts.after, "top", geometry.afterTop - bias);
      const first =
        this.first === undefined
          ? undefined
          : this.scroller.offsetOf(this.first);
      if (first !== undefined) px(parts.items, "top", first - bias);
      if (!bias && Math.abs(this.known - geometry.top) >= 0.5) {
        scroll.scrollTop = geometry.top;
        this.known = scroll.scrollTop;
      }
    } finally {
      this.writing = false;
    }
  }
}
