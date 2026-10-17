/**
 * The play order, as pure functions. Two lists feed playback, as in Spotify:
 *  - the user queue ("Next in queue"): tracks added on purpose; they play before the
 *    context continues and are removed once started. Shuffle and repeat never touch it.
 *  - the context ("Next from <title>"): the album, playlist, artist or result list the
 *    playback started from, with its own shuffled order and cursor.
 */
export type Repeat = "off" | "context" | "one";
export type Random = () => number;
/** Seconds into a track after which "previous" restarts it instead of going back. */
export const RESTART_AFTER_SECONDS = 3;

export interface PlayContext {
  title: string;
  /** The tracks in list order. */
  ids: readonly string[];
  /** Indices into `ids` in play order; shuffling permutes the part after `pos`. */
  order: readonly number[];
  /** Index into `order` of the context track played last. */
  pos: number;
  shuffled: boolean;
}

function shuffledCopy<T>(items: readonly T[], random: Random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** A context of `ids` starting at `startId` (prepended when it is not part of them). */
export function openContext(
  title: string,
  ids: readonly string[],
  startId: string,
  shuffle: boolean,
  random: Random,
): PlayContext {
  const all = ids.includes(startId) ? ids : [startId, ...ids];
  const start = all.indexOf(startId);
  const others = range(all.length).filter((i) => i !== start);
  return {
    title,
    ids: all,
    order: shuffle
      ? [start, ...shuffledCopy(others, random)]
      : range(all.length),
    pos: shuffle ? 0 : start,
    shuffled: shuffle,
  };
}
export const contextCurrent = (c: PlayContext): string | undefined =>
  c.ids[c.order[c.pos]!];
/** The tracks still to come from the context, in play order. */
export const upcoming = (c: PlayContext | null): string[] =>
  c ? c.order.slice(c.pos + 1).map((i) => c.ids[i]!) : [];

/** Turns shuffle on or off keeping the current track; shuffle keeps what was played. */
export function withShuffle(
  c: PlayContext,
  shuffle: boolean,
  random: Random,
): PlayContext {
  if (c.shuffled === shuffle) return c;
  if (shuffle)
    return {
      ...c,
      shuffled: true,
      order: [
        ...c.order.slice(0, c.pos + 1),
        ...shuffledCopy(c.order.slice(c.pos + 1), random),
      ],
    };
  return {
    ...c,
    shuffled: false,
    order: range(c.ids.length),
    pos: c.order[c.pos] ?? 0,
  };
}
/** Moves an upcoming track one place; `index` counts from the first upcoming track. */
export function moveUpcoming(
  c: PlayContext,
  index: number,
  delta: -1 | 1,
): PlayContext {
  const from = c.pos + 1 + index,
    to = from + delta;
  if (
    index < 0 ||
    to <= c.pos ||
    to >= c.order.length ||
    from >= c.order.length
  )
    return c;
  const order = c.order.slice();
  [order[from], order[to]] = [order[to]!, order[from]!];
  return { ...c, order };
}
export function removeUpcoming(c: PlayContext, index: number): PlayContext {
  const at = c.pos + 1 + index;
  if (index < 0 || at >= c.order.length) return c;
  return { ...c, order: c.order.filter((_, i) => i !== at) };
}
/** Makes the upcoming track at `index` the current one, skipping what was before it. */
export function jumpUpcoming(c: PlayContext, index: number): PlayContext {
  const at = c.pos + 1 + index;
  return index < 0 || at >= c.order.length ? c : { ...c, pos: at };
}

export interface Flow {
  context: PlayContext | null;
  queue: readonly string[];
  repeat: Repeat;
}
export interface Step {
  /** The track to play; null when nothing follows. */
  id: string | null;
  context: PlayContext | null;
  queue: readonly string[];
  /** The track came from the user queue (and was removed from it). */
  fromQueue: boolean;
}
/**
 * The track after the current one. `auto` is the end of a track (repeat-one replays it);
 * a manual "next" moves on. The user queue comes first, then the context, which wraps
 * (reshuffled when shuffled) under repeat-context.
 */
export function advance(
  flow: Flow,
  auto: boolean,
  current: string | null,
  random: Random,
): Step {
  const { context, queue, repeat } = flow;
  if (auto && repeat === "one" && current)
    return { id: current, context, queue, fromQueue: false };
  if (queue.length)
    return { id: queue[0]!, context, queue: queue.slice(1), fromQueue: true };
  if (context && context.order.length) {
    if (context.pos + 1 < context.order.length) {
      const next = { ...context, pos: context.pos + 1 };
      return {
        id: contextCurrent(next)!,
        context: next,
        queue,
        fromQueue: false,
      };
    }
    if (repeat !== "off") {
      const wrapped = context.shuffled
        ? withShuffle({ ...context, shuffled: false }, true, random)
        : context;
      const next = { ...wrapped, pos: 0 };
      return {
        id: contextCurrent(next)!,
        context: next,
        queue,
        fromQueue: false,
      };
    }
  }
  return { id: null, context, queue, fromQueue: false };
}
export type Retreat =
  { restart: true } | { restart: false; id: string; context: PlayContext };
/**
 * "Previous": restarts the track once past 3 s, otherwise the previous track of the
 * context. A track from the user queue goes back to the context track played last.
 */
export function retreat(
  flow: Pick<Flow, "context" | "repeat">,
  fromQueue: boolean,
  seconds: number,
): Retreat {
  const { context, repeat } = flow;
  if (seconds > RESTART_AFTER_SECONDS || !context || !context.order.length)
    return { restart: true };
  if (fromQueue)
    return { restart: false, id: contextCurrent(context)!, context };
  if (context.pos > 0) {
    const back = { ...context, pos: context.pos - 1 };
    return { restart: false, id: contextCurrent(back)!, context: back };
  }
  if (repeat !== "off") {
    const last = { ...context, pos: context.order.length - 1 };
    return { restart: false, id: contextCurrent(last)!, context: last };
  }
  return { restart: true };
}
