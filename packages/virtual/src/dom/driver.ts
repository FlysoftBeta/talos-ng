import type { Geometry, Reading } from "../core/scroller.ts";

/** The part of a `Scroller` the DOM side talks to. */
export interface ScrollerSurface {
  sense(reading: Reading): void;
  release(): void;
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
const FALLBACK = ["load", "error", "transitionend", "animationend"];
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
  private observing = false;
  private writing = false;
  private frame = 0;
  private readonly deferred = new Set<() => void>();

  constructor(private readonly scroller: ScrollerSurface) {}

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
    const sync = (): void => this.sync();
    scroll.addEventListener("scroll", scrolled);
    RELEASE.forEach((type) =>
      scroll.addEventListener(type, release, { passive: true }),
    );
    this.cleanups.push(() => {
      scroll.removeEventListener("scroll", scrolled);
      RELEASE.forEach((type) => scroll.removeEventListener(type, release));
    });
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => {
        this.observing = true;
        try {
          this.sync();
        } finally {
          this.observing = false;
        }
      });
      this.observer = observer;
      [scroll, parts.before, parts.after, ...this.elements.values()].forEach(
        (element) => observer.observe(element),
      );
      this.cleanups.push(() => observer.disconnect());
    } else {
      // Without ResizeObserver: re-measure when media settle, animations end or the window resizes.
      FALLBACK.forEach((type) => scroll.addEventListener(type, sync, true));
      window.addEventListener("resize", sync);
      this.cleanups.push(() => {
        FALLBACK.forEach((type) =>
          scroll.removeEventListener(type, sync, true),
        );
        window.removeEventListener("resize", sync);
      });
    }
    this.cleanups.push(this.scroller.observe(() => this.write()));
    this.sync();
  }
  detach(): void {
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
    if (!scroll.getClientRects().length) return;
    const sizes: Array<[string, number]> = [];
    this.elements.forEach((element, id) =>
      sizes.push([id, element.getBoundingClientRect().height]),
    );
    const top = scroll.scrollTop;
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
  private scrolled(): void {
    const scroll = this.parts?.scroll;
    if (!scroll) return;
    const top = scroll.scrollTop;
    const delta = top - this.known;
    if (Math.abs(delta) < 0.5) return;
    this.known = top;
    this.scroller.sense({ scrolledBy: delta });
  }
  private write(): void {
    const parts = this.parts;
    if (!parts || this.writing) return;
    this.writing = true;
    try {
      const { scroll } = parts;
      // A user scroll not yet reported must reach the scroller before it is overwritten.
      if (Math.abs(scroll.scrollTop - this.known) >= 0.5) this.scrolled();
      const geometry = this.scroller.geometry();
      px(parts.canvas, "height", geometry.height);
      px(parts.after, "top", geometry.afterTop);
      const first =
        this.first === undefined
          ? undefined
          : this.scroller.offsetOf(this.first);
      if (first !== undefined) px(parts.items, "top", first);
      if (Math.abs(this.known - geometry.top) >= 0.5) {
        scroll.scrollTop = geometry.top;
        this.known = scroll.scrollTop;
      }
    } finally {
      this.writing = false;
    }
  }
}
