import { compareStamp } from "@talos/base";
import type { MediaTrack, MediaUserState } from "@talos/contract";

type QueueStamp = MediaUserState["queueStamp"];
export interface QueueRow {
  id: string;
  title: string;
  canUp: boolean;
  canDown: boolean;
}

/**
 * The queue the user last asked for. Queued offline commands are not yet in the synced
 * state, so the intended order is kept here until a newer stamp arrives from the rows.
 */
export class QueueTracker {
  private queue: readonly string[] = [];
  private stamp: QueueStamp = null;
  private user: string | null | undefined = undefined;
  /** Resets on account change, then adopts a synced queue newer than the local intent. */
  sync(user: string | undefined, state: MediaUserState | null): void {
    const queue = state?.queue ?? [];
    if (this.user !== (user ?? null)) {
      this.user = user ?? null;
      this.queue = queue;
      this.stamp = state?.queueStamp ?? null;
    }
    const remote = state?.queueStamp;
    if (
      remote &&
      (!this.stamp ||
        compareStamp(remote.t, this.stamp.t) > 0 ||
        (compareStamp(remote.t, this.stamp.t) === 0 &&
          remote.op > this.stamp.op))
    ) {
      this.queue = queue;
      this.stamp = remote;
    }
  }
  get tracks(): readonly string[] {
    return this.queue;
  }
  replace(tracks: readonly string[], stamp: NonNullable<QueueStamp>): void {
    this.queue = tracks;
    this.stamp = stamp;
  }
}
export const withTrackLast = (
  queue: readonly string[],
  id: string,
): string[] => [...queue.filter((value) => value !== id), id];
export const withTrackFirst = (
  queue: readonly string[],
  id: string,
): string[] => [id, ...queue.filter((value) => value !== id)];
export function movedTrack(
  queue: readonly string[],
  index: number,
  delta: -1 | 1,
): string[] {
  const out = queue.slice(),
    other = index + delta;
  if (other < 0 || other >= out.length) return out;
  [out[other], out[index]] = [out[index]!, out[other]!];
  return out;
}
export const withoutTrackAt = (
  queue: readonly string[],
  index: number,
): string[] => queue.filter((_, i) => i !== index);
export function queueRows(
  queue: readonly string[],
  tracks: readonly MediaTrack[],
): QueueRow[] {
  return queue.map((id, index) => ({
    id,
    title: tracks.find((t) => t.id === id)?.title ?? id,
    canUp: index > 0,
    canDown: index < queue.length - 1,
  }));
}
