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
  /** Debounced register write: not sent before this executor time. */
  readonly notBefore?: number;
  /** Latest notBefore a register write keeps when later writes merge into it. */
  readonly deadline?: number;
}

export type EnqueueItem = Pick<
  OutboxItem,
  | "op"
  | "method"
  | "args"
  | "createdAt"
  | "dependsOn"
  | "notBefore"
  | "deadline"
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
  /**
   * Order-irrelevant state upserts (last-writer-wins, maximum, per-device counters)
   * name the register they write. They bypass order-key FIFO, travel with any other
   * operations, and a pending write merges with a later write to the same register.
   * Operations without a register keep strict FIFO per order key.
   */
  readonly register?: (method: string, args: unknown) => string | undefined;
  /** Arguments equivalent to applying `earlier` then `later`; default `later`. */
  readonly merge?: (
    method: string,
    earlier: unknown,
    later: unknown,
  ) => unknown;
}

function barrier(item: OutboxItem, options: SendOptions): string {
  const register = options.register?.(item.method, item.args);
  return register === undefined
    ? JSON.stringify(["order", options.orderKey(item.method, item.args)])
    : JSON.stringify(["register", item.method, register]);
}

/** Replace a pending write to the same register; sending and failed writes stay. */
function mergeRegister(
  items: readonly OutboxItem[],
  item: EnqueueItem,
  options: SendOptions,
): { items: readonly OutboxItem[]; item: EnqueueItem } {
  const register = options.register?.(item.method, item.args);
  if (register === undefined) return { items, item };
  const referenced = new Set<string>();
  for (const entry of items)
    for (const dependency of entry.dependsOn ?? []) referenced.add(dependency);
  const earlier = items.find(
    (entry) =>
      entry.state === "pending" &&
      entry.method === item.method &&
      !entry.discardedDependencies?.length &&
      !referenced.has(entry.op) &&
      !item.dependsOn?.includes(entry.op) &&
      options.register!(entry.method, entry.args) === register,
  );
  if (!earlier) return { items, item };
  const deadline = Math.min(
    earlier.deadline ?? Infinity,
    item.deadline ?? Infinity,
  );
  const dependsOn = [
    ...new Set([...(earlier.dependsOn ?? []), ...(item.dependsOn ?? [])]),
  ];
  return {
    items: items.filter((entry) => entry !== earlier),
    // The later operation id is fresh: an earlier id may already have been applied
    // under its old arguments, and the server's idempotency cache would replay that.
    item: {
      ...item,
      args: options.merge
        ? options.merge(item.method, earlier.args, item.args)
        : item.args,
      createdAt: earlier.createdAt,
      ...(dependsOn.length ? { dependsOn } : { dependsOn: undefined }),
      ...(item.notBefore !== undefined
        ? { notBefore: Math.min(item.notBefore, deadline) }
        : {}),
      ...(Number.isFinite(deadline) ? { deadline } : {}),
    },
  };
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

/**
 * Array position is durable FIFO order; creation timestamps need not be monotonic.
 * With `now`, debounced register writes wait for their `notBefore`.
 */
export function nextToSend(
  items: readonly OutboxItem[],
  options: SendOptions,
  now?: number,
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
    if (item.state === "sending") blockedKeys.add(barrier(item, options));
  for (const item of items) {
    const key = barrier(item, options);
    if (blockedKeys.has(key)) continue;
    blockedKeys.add(key);
    if (
      capacity <= 0 ||
      item.state !== "pending" ||
      item.discardedDependencies?.length ||
      (now !== undefined &&
        item.notBefore !== undefined &&
        item.notBefore > now)
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
    if (items.some((existing) => existing.op === event.item.op))
      throw new AppError("E_CONFLICT", "重复的操作标识");
    const merged = mergeRegister(items, event.item, options);
    const item = merged.item;
    const remaining = merged.items;
    valid(
      item.op.length > 0 && item.method.length > 0,
      "Operation and method must be nonempty",
    );
    integer(item.createdAt, "createdAt");
    const outstanding = new Set(remaining.map((existing) => existing.op));
    valid(
      (item.dependsOn ?? []).every((op) => outstanding.has(op)),
      "Dependencies must already be queued",
    );
    return cascade([
      ...remaining,
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
