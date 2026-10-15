import { compareStamp, isUlid } from "@talos/base";
import type { Stamp } from "@talos/base";
import { integer, valid } from "./validate.ts";

export type { Stamp } from "@talos/base";

export interface Lww<T> {
  readonly v: T;
  readonly t: Stamp;
  readonly op: string;
}

function stampValid(stamp: Stamp): void {
  integer(stamp.ms, "stamp.ms");
  integer(stamp.counter, "stamp.counter");
}

function lwwValid<T>(value: Lww<T>): void {
  stampValid(value.t);
  valid(isUlid(value.op), "Invalid LWW operation ULID");
}

/** Equal (stamp, op) identities must describe the same write. */
export function lwwMerge<T>(a: Lww<T>, b: Lww<T>): Lww<T> {
  lwwValid(a);
  lwwValid(b);
  const order = compareStamp(a.t, b.t);
  return order > 0 || (order === 0 && a.op >= b.op) ? a : b;
}

export function lwwSet<T>(
  current: Lww<T> | undefined,
  v: T,
  t: Stamp,
  op: string,
): Lww<T> {
  const next = { v, t: { ...t }, op };
  lwwValid(next);
  return current === undefined ? next : lwwMerge(current, next);
}

export interface SeqCursor {
  readonly seq: number;
  readonly id: string;
}
export type Max<T extends number | SeqCursor = number> = T;

export function maxMerge(a: number, b: number): number;
export function maxMerge(a: SeqCursor, b: SeqCursor): SeqCursor;
export function maxMerge(
  a: number | SeqCursor,
  b: number | SeqCursor,
): number | SeqCursor {
  if (typeof a === "number" && typeof b === "number") {
    valid(
      Number.isFinite(a) && Number.isFinite(b),
      "Max values must be finite",
    );
    return Math.max(a, b);
  }
  valid(typeof a !== "number" && typeof b !== "number", "Max kinds must match");
  integer(a.seq, "cursor.seq");
  integer(b.seq, "cursor.seq");
  valid(
    typeof a.id === "string" && typeof b.id === "string",
    "Invalid cursor id",
  );
  return a.seq > b.seq || (a.seq === b.seq && a.id >= b.id) ? a : b;
}

export interface Tombstone {
  readonly rev: number;
  readonly deleted: boolean;
}

/** Same-kind, same-revision facts must have identical content. */
export function mergeImmutable<L extends Tombstone, R extends Tombstone>(
  local: L,
  remote: R,
): L | R {
  integer(local.rev, "revision");
  integer(remote.rev, "revision");
  if (local.deleted !== remote.deleted) return local.deleted ? local : remote;
  return local.rev >= remote.rev ? local : remote;
}

export interface ClampedStamp {
  readonly stamp: Stamp;
  readonly clamped: boolean;
}

export function clampFutureStamp(
  stamp: Stamp,
  now: number,
  maxSkewMs: number,
): ClampedStamp {
  stampValid(stamp);
  integer(now, "now");
  integer(maxSkewMs, "maxSkewMs");
  const ceiling = Math.min(Number.MAX_SAFE_INTEGER, now + maxSkewMs);
  const clamped = stamp.ms > ceiling;
  return {
    stamp: clamped ? { ms: ceiling, counter: 0 } : { ...stamp },
    clamped,
  };
}
