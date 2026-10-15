/**
 * The contract between a scroller and the data source that owns its items.
 *
 * Items are tracked by id, never by index: the scroller holds a contiguous window of the
 * source's ordered list and knows only whether more exists beyond each end. Everything the
 * source says (replies and spontaneous changes) travels through one ordered event stream, so
 * a reply always reflects every change emitted before it.
 */

export type Direction = "before" | "after";
export type Align = "start" | "center" | "end";

export interface Entry<T> {
  /** Unique within the source's whole list; stable for the item's lifetime. */
  readonly id: string;
  /** Owned by the source; the scroller never mutates or copies it. */
  readonly item: T;
  /** Size hint in px, used until the item is measured. */
  readonly size?: number;
}

/** Where a seek lands: an end of the whole list, a known id, or a source-defined key. */
export type Seek<L = never> =
  | { readonly edge: "start" | "end" }
  | { readonly id: string }
  | { readonly key: L };

/**
 * `seek` replaces the window with a slice that contains the target. `extend` asks for the
 * items immediately beyond `from`, the current first (`before`) or last (`after`) loaded id.
 */
export type Request<L = never> =
  | { readonly kind: "seek"; readonly token: number; readonly seek: Seek<L> }
  | {
      readonly kind: "extend";
      readonly token: number;
      readonly direction: Direction;
      readonly from: string;
    };

/**
 * Insert position: next to an id, or at an end of the whole list. An end applies only when
 * the window has reached that end; an id applies only when the window contains it.
 */
export type Place =
  "start" | "end" | { readonly after: string } | { readonly before: string };

export type SourceEvent<T> =
  /** Reply to a seek. `focus` is the id the seek resolved to (absent: not found). */
  | {
      readonly type: "seeked";
      readonly token: number;
      readonly items: readonly Entry<T>[];
      readonly before: boolean;
      readonly after: boolean;
      readonly focus?: string;
    }
  /** Reply to an extend: the items adjacent to `from`, in list order. */
  | {
      readonly type: "extended";
      readonly token: number;
      readonly items: readonly Entry<T>[];
      readonly more: boolean;
    }
  | { readonly type: "failed"; readonly token: number; readonly error: unknown }
  | {
      readonly type: "insert";
      readonly place: Place;
      readonly items: readonly Entry<T>[];
    }
  /** New payloads (and optionally new size hints) for existing ids. */
  | { readonly type: "update"; readonly items: readonly Entry<T>[] }
  | { readonly type: "remove"; readonly ids: readonly string[] }
  /** Whether more exists beyond an end changed. `more: true` also re-arms a failed end. */
  | {
      readonly type: "more";
      readonly direction: Direction;
      readonly more: boolean;
    }
  /** The order changed in a way inserts cannot express: reload around the current anchor. */
  | { readonly type: "invalidate" };

export interface Source<T, L = never> {
  /** Starts the event stream. Returns the disconnect function. */
  connect(emit: (event: SourceEvent<T>) => void): () => void;
  /**
   * Answer later (or synchronously) through `emit` with the request's token. A seek reply
   * without items must report no more on either side.
   */
  request(request: Request<L>): void;
}
