import { AppError } from "@talos/base";
import type { AppErrorJSON, ErrorCode } from "@talos/base";
import { integer, valid } from "./validate.ts";

export interface OutboxItem {
  readonly op: string;
  readonly method: string;
  readonly args: unknown;
  readonly createdAt: number;
  readonly state: "pending" | "sending" | "failed";
  readonly attempts: number;
  readonly error?: AppErrorJSON;
  readonly dependsOn?: readonly string[];
  /** Permanent blockers survive removal of discarded operations. */
  readonly discardedDependencies?: readonly string[];
  /** Duration hint only; the executor owns clocks, jitter and scheduling. */
  readonly retryAfterMs?: number;
}

export type EnqueueItem = Pick<
  OutboxItem,
  "op" | "method" | "args" | "createdAt" | "dependsOn"
>;
export type OutboxEvent =
  | { readonly type: "enqueue"; readonly item: EnqueueItem }
  | {
      readonly type: "sendStarted" | "acked" | "retry" | "discard";
      readonly op: string;
    }
  | {
      readonly type: "rejected" | "transportFailed";
      readonly op: string;
      readonly error: AppErrorJSON;
    }
  | { readonly type: "connectionLost" };

export interface SendOptions {
  readonly maxInFlight: number;
  readonly orderKey: (method: string, args: unknown) => string;
}

export function isTerminalRejection(code: ErrorCode): boolean {
  return (
    code === "E_DENIED" ||
    code === "E_INVALID" ||
    code === "E_NOT_FOUND" ||
    code === "E_CONFLICT" ||
    code === "E_TOO_LARGE"
  );
}

export function attemptBackoffMs(attempts: number): number {
  integer(attempts, "attempts");
  return attempts === 0
    ? 0
    : Math.min(30_000, 500 * 2 ** Math.min(attempts - 1, 6));
}

function conflict(dependency: string): AppErrorJSON {
  return new AppError("E_CONFLICT", "前置操作未完成", { dependency }).toJSON();
}

/** Fixed point also handles persisted lists whose dependency order is arbitrary. */
function cascade(items: readonly OutboxItem[]): readonly OutboxItem[] {
  let next = items;
  for (;;) {
    const failed = new Set(
      next.filter((item) => item.state === "failed").map((item) => item.op),
    );
    let changed = false;
    const pass = next.map((item) => {
      const blocker =
        item.discardedDependencies?.[0] ??
        item.dependsOn?.find((op) => failed.has(op));
      if (blocker === undefined || item.state === "failed") return item;
      changed = true;
      return {
        ...item,
        state: "failed" as const,
        error: conflict(blocker),
        retryAfterMs: undefined,
      };
    });
    if (!changed) return next;
    next = pass;
  }
}

/** Array position is durable FIFO order; creation timestamps need not be monotonic. */
export function nextToSend(
  items: readonly OutboxItem[],
  options: SendOptions,
): readonly OutboxItem[] {
  integer(options.maxInFlight, "maxInFlight");
  let capacity =
    options.maxInFlight -
    items.filter((item) => item.state === "sending").length;
  const outstanding = new Set(items.map((item) => item.op));
  const blockedKeys = new Set<string>();
  const selected: OutboxItem[] = [];
  // Reserve sending keys even for a restored list containing an earlier pending item.
  for (const item of items)
    if (item.state === "sending")
      blockedKeys.add(options.orderKey(item.method, item.args));
  for (const item of items) {
    const key = options.orderKey(item.method, item.args);
    if (blockedKeys.has(key)) continue;
    blockedKeys.add(key);
    if (
      capacity <= 0 ||
      item.state !== "pending" ||
      item.discardedDependencies?.length
    )
      continue;
    if (item.dependsOn?.some((op) => outstanding.has(op))) continue;
    selected.push(item);
    capacity--;
  }
  return selected;
}

/** Persist the entire returned list atomically, before performing any network effect. */
export function reduceOutbox(
  items: readonly OutboxItem[],
  event: OutboxEvent,
  options: SendOptions,
): readonly OutboxItem[] {
  if (event.type === "enqueue") {
    const item = event.item;
    valid(
      item.op.length > 0 && item.method.length > 0,
      "Operation and method must be nonempty",
    );
    integer(item.createdAt, "createdAt");
    if (items.some((existing) => existing.op === item.op))
      throw new AppError("E_CONFLICT", "重复的操作标识");
    const outstanding = new Set(items.map((existing) => existing.op));
    valid(
      (item.dependsOn ?? []).every((op) => outstanding.has(op)),
      "Dependencies must already be queued",
    );
    return cascade([
      ...items,
      {
        ...item,
        dependsOn: item.dependsOn?.slice(),
        state: "pending",
        attempts: 0,
      },
    ]);
  }
  if (event.type === "connectionLost") {
    return cascade(
      items.map((item) =>
        item.state === "sending"
          ? {
              ...item,
              state: "pending",
              error: new AppError("E_DISCONNECTED", "连接已断开").toJSON(),
              retryAfterMs: attemptBackoffMs(item.attempts),
            }
          : item,
      ),
    );
  }
  const target = items.find((item) => item.op === event.op);
  // Duplicate/late replies to a removed operation are harmless.
  if (!target) return items;
  if (event.type === "discard") {
    valid(target.state !== "sending", "Cannot discard an in-flight operation");
    const next = items
      .filter((item) => item.op !== event.op)
      .map((item) =>
        item.dependsOn?.includes(event.op)
          ? {
              ...item,
              discardedDependencies: [
                ...(item.discardedDependencies ?? []),
                event.op,
              ],
            }
          : item,
      );
    return cascade(next);
  }
  if (event.type === "acked") {
    // A success received after connectionLost still settles the idempotent op.
    return cascade(
      items
        .filter((item) => item.op !== event.op)
        .map((item) => ({
          ...item,
          dependsOn: item.dependsOn?.filter((op) => op !== event.op),
        })),
    );
  }
  if (event.type === "sendStarted") {
    valid(
      nextToSend(items, options).some((item) => item.op === event.op),
      "Operation is not eligible to send",
    );
    integer(target.attempts + 1, "attempts");
  }
  return cascade(
    items.map((item): OutboxItem => {
      if (item.op !== event.op) return item;
      switch (event.type) {
        case "sendStarted":
          return {
            ...item,
            state: "sending",
            attempts: item.attempts + 1,
            error: undefined,
            retryAfterMs: undefined,
          };
        case "retry":
          return item.state === "failed"
            ? {
                ...item,
                state: "pending",
                error: undefined,
                retryAfterMs: undefined,
              }
            : item;
        case "rejected":
        case "transportFailed": {
          if (item.state !== "sending") return item;
          const terminal =
            event.type === "rejected" && isTerminalRejection(event.error.code);
          return {
            ...item,
            state: terminal ? "failed" : "pending",
            error: new AppError(
              event.error.code,
              event.error.message,
              event.error.data,
            ).toJSON(),
            retryAfterMs: terminal
              ? undefined
              : attemptBackoffMs(item.attempts),
          };
        }
        default:
          return item;
      }
    }),
  );
}

/** Return a register identity only for methods that are safe to replace wholesale. */
export type CoalesceRule = (item: OutboxItem) => string | undefined;

export function coalesce(
  items: readonly OutboxItem[],
  rule: CoalesceRule,
): readonly OutboxItem[] {
  const referenced = new Set<string>();
  for (const item of items)
    for (const dependency of item.dependsOn ?? []) referenced.add(dependency);
  const later = new Set<string>();
  const retained: OutboxItem[] = [];
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]!;
    const key = rule(item);
    // Sending/failed writes are barriers: do not change meaning across them.
    if (key === undefined) {
      retained.push(item);
      continue;
    }
    if (
      item.state !== "pending" ||
      item.dependsOn?.length ||
      item.discardedDependencies?.length ||
      referenced.has(item.op)
    ) {
      later.delete(key);
      retained.push(item);
      continue;
    }
    if (!later.has(key)) retained.push(item);
    later.add(key);
  }
  return retained.reverse();
}
