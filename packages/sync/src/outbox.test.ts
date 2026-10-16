import { AppError, ERROR_CODES } from "@talos/base";
import type { ErrorCode } from "@talos/base";
import { describe, expect, it } from "vitest";
import { random } from "../test/random.ts";
import {
  attemptBackoffMs,
  coalesce,
  isTerminalRejection,
  nextToSend,
  reduceOutbox,
} from "./outbox.ts";
import type { EnqueueItem, OutboxEvent, OutboxItem } from "./outbox.ts";

const options = {
  maxInFlight: 3,
  orderKey: (_method: string, args: unknown): string => String(args),
};
const item = (
  op: string,
  args: unknown = "a",
  dependsOn?: readonly string[],
): EnqueueItem => ({ op, method: "write", args, createdAt: 0, dependsOn });
const enqueue = (
  items: readonly OutboxItem[],
  op: string,
  args: unknown = "a",
  dependsOn?: readonly string[],
): readonly OutboxItem[] =>
  reduceOutbox(
    items,
    { type: "enqueue", item: item(op, args, dependsOn) },
    options,
  );
const send = (
  items: readonly OutboxItem[],
  op: string,
): readonly OutboxItem[] =>
  reduceOutbox(items, { type: "sendStarted", op }, options);
const error = (code: ErrorCode): AppError => new AppError(code, code);

describe("outbox", () => {
  it("selects FIFO per key, reserves sending keys and honors the global cap", () => {
    let items = enqueue([], "1");
    items = enqueue(items, "2");
    items = enqueue(items, "3", "b");
    items = enqueue(items, "4", "c");
    expect(nextToSend(items, options).map((x) => x.op)).toEqual([
      "1",
      "3",
      "4",
    ]);
    items = send(items, "1");
    expect(
      nextToSend(items, { ...options, maxInFlight: 2 }).map((x) => x.op),
    ).toEqual(["3"]);
    expect(() => send(items, "2")).toThrow(AppError);
    expect(nextToSend(items, { ...options, maxInFlight: 0 })).toEqual([]);
    expect(nextToSend(items, { ...options, maxInFlight: 1 })).toEqual([]);
    expect(() => nextToSend(items, { ...options, maxInFlight: -1 })).toThrow(
      AppError,
    );
  });

  it("uses enqueue order rather than timestamps", () => {
    let items = reduceOutbox(
      [],
      { type: "enqueue", item: { ...item("1"), createdAt: 10 } },
      options,
    );
    items = enqueue(items, "2");
    expect(nextToSend(items, options).map((x) => x.op)).toEqual(["1"]);
  });

  it("increments attempts only on send and requeues all sending operations on connection loss", () => {
    let items = enqueue(enqueue([], "1"), "2", "b");
    items = send(send(items, "1"), "2");
    const before = items;
    items = reduceOutbox(items, { type: "connectionLost" }, options);
    expect(items.map((x) => [x.state, x.attempts, x.retryAfterMs])).toEqual([
      ["pending", 1, 500],
      ["pending", 1, 500],
    ]);
    expect(before.every((x) => x.state === "sending")).toBe(true);
    items = send(items, "1");
    expect(items[0]?.attempts).toBe(2);
    expect(items[0]?.error).toBeUndefined();
    expect(items[0]?.retryAfterMs).toBeUndefined();
  });

  it.each(ERROR_CODES)(
    "classifies rejection %s and preserves the operation",
    (code) => {
      const terminal = [
        "E_DENIED",
        "E_INVALID",
        "E_NOT_FOUND",
        "E_CONFLICT",
        "E_TOO_LARGE",
      ].includes(code);
      expect(isTerminalRejection(code)).toBe(terminal);
      const items = reduceOutbox(
        send(enqueue([], "1"), "1"),
        { type: "rejected", op: "1", error: error(code).toJSON() },
        options,
      );
      expect(items).toHaveLength(1);
      expect(items[0]?.state).toBe(terminal ? "failed" : "pending");
      expect(items[0]?.retryAfterMs).toBe(terminal ? undefined : 500);
      expect(items[0]?.error?.code).toBe(code);
    },
  );

  it("transport failures never fail operations, regardless of error code", () => {
    const items = reduceOutbox(
      send(enqueue([], "1"), "1"),
      { type: "transportFailed", op: "1", error: error("E_DENIED") },
      options,
    );
    expect(items[0]?.state).toBe("pending");
    expect(items[0]?.attempts).toBe(1);
  });

  it("serializes Error messages as well as plain wire errors", () => {
    const items = reduceOutbox(
      send(enqueue([], "1"), "1"),
      {
        type: "rejected",
        op: "1",
        error: new AppError("E_DENIED", "保留此消息", { reason: "policy" }),
      },
      options,
    );
    expect(JSON.parse(JSON.stringify(items[0]?.error))).toEqual({
      code: "E_DENIED",
      message: "保留此消息",
      data: { reason: "policy" },
    });
  });

  it("failed operations block later writes on their key until retry or discard", () => {
    let items = enqueue(enqueue([], "1"), "2");
    items = reduceOutbox(
      send(items, "1"),
      { type: "rejected", op: "1", error: error("E_INVALID") },
      options,
    );
    expect(nextToSend(items, options)).toEqual([]);
    items = reduceOutbox(items, { type: "retry", op: "1" }, options);
    expect(nextToSend(items, options).map((x) => x.op)).toEqual(["1"]);
    expect(items[0]?.attempts).toBe(1);
    items = reduceOutbox(items, { type: "discard", op: "1" }, options);
    expect(nextToSend(items, options).map((x) => x.op)).toEqual(["2"]);
  });

  it("dependencies wait for ack, even across distinct ordering keys", () => {
    let items = enqueue(enqueue([], "1"), "2", "b", ["1"]);
    expect(nextToSend(items, options).map((x) => x.op)).toEqual(["1"]);
    items = send(items, "1");
    expect(nextToSend(items, options)).toEqual([]);
    items = reduceOutbox(items, { type: "acked", op: "1" }, options);
    expect(nextToSend(items, options).map((x) => x.op)).toEqual(["2"]);
    expect(items[0]?.dependsOn).toEqual([]);
  });

  it("cascades rejection through a dependency DAG and supports explicit recovery", () => {
    let items = enqueue(enqueue(enqueue([], "1"), "2", "b", ["1"]), "3", "c", [
      "2",
    ]);
    items = reduceOutbox(
      send(items, "1"),
      { type: "rejected", op: "1", error: error("E_DENIED") },
      options,
    );
    expect(items.map((x) => x.error?.code)).toEqual([
      "E_DENIED",
      "E_CONFLICT",
      "E_CONFLICT",
    ]);
    expect(
      reduceOutbox(items, { type: "retry", op: "3" }, options)[2]?.state,
    ).toBe("failed");
    items = enqueue(items, "4", "d", ["3"]);
    expect(items[3]?.state).toBe("failed");
    items = reduceOutbox(items, { type: "retry", op: "1" }, options);
    items = reduceOutbox(send(items, "1"), { type: "acked", op: "1" }, options);
    items = reduceOutbox(items, { type: "retry", op: "2" }, options);
    expect(nextToSend(items, options).map((x) => x.op)).toEqual(["2"]);
  });

  it("discard markers survive persistence, retries and late acknowledgments", () => {
    let items = enqueue(enqueue(enqueue([], "1"), "2", "b", ["1"]), "3", "c", [
      "2",
    ]);
    items = reduceOutbox(items, { type: "discard", op: "1" }, options);
    expect(items.map((x) => [x.op, x.state])).toEqual([
      ["2", "failed"],
      ["3", "failed"],
    ]);
    items = JSON.parse(JSON.stringify(items)) as OutboxItem[];
    items = reduceOutbox(items, { type: "retry", op: "2" }, options);
    expect(items[0]?.state).toBe("failed");
    expect(reduceOutbox(items, { type: "acked", op: "1" }, options)).toBe(
      items,
    );
    expect(nextToSend(items, options)).toEqual([]);
  });

  it("rejects duplicate ids, forward/cyclic dependencies and in-flight discard", () => {
    const items = enqueue([], "1");
    expect(() => enqueue(items, "1")).toThrow(AppError);
    expect(() => enqueue(items, "2", "b", ["missing"])).toThrow(AppError);
    expect(() => enqueue(items, "2", "b", ["2"])).toThrow(AppError);
    expect(() =>
      reduceOutbox(send(items, "1"), { type: "discard", op: "1" }, options),
    ).toThrow(AppError);
  });

  it("ignores unknown/duplicate replies and accepts late success after disconnect", () => {
    let items = send(enqueue([], "1"), "1");
    items = reduceOutbox(items, { type: "connectionLost" }, options);
    items = reduceOutbox(items, { type: "acked", op: "1" }, options);
    expect(items).toEqual([]);
    expect(reduceOutbox(items, { type: "acked", op: "1" }, options)).toBe(
      items,
    );
    expect(
      reduceOutbox(
        items,
        { type: "rejected", op: "1", error: error("E_DENIED") },
        options,
      ),
    ).toBe(items);
  });

  it("returns bounded deterministic backoff durations", () => {
    expect(
      [0, 1, 2, 3, 6, 7, 100, Number.MAX_SAFE_INTEGER].map(attemptBackoffMs),
    ).toEqual([0, 500, 1000, 2000, 16000, 30000, 30000, 30000]);
    expect(() => attemptBackoffMs(-1)).toThrow(AppError);
  });

  it("coalesces only replaceable pending writes and keeps the later FIFO position", () => {
    const items = enqueue(enqueue(enqueue([], "1"), "2", "b"), "3");
    expect(coalesce(items, (x) => String(x.args)).map((x) => x.op)).toEqual([
      "2",
      "3",
    ]);
    expect(coalesce(items, () => undefined)).toEqual(items);
    expect(items).toHaveLength(3);
  });

  it("coalescing preserves sending/failed writes and dependency edges", () => {
    let items = enqueue(enqueue([], "1"), "2");
    expect(coalesce(send(items, "1"), () => "key").map((x) => x.op)).toEqual([
      "1",
      "2",
    ]);
    items = enqueue(items, "3", "b", ["1"]);
    expect(coalesce(items, (x) => String(x.args)).map((x) => x.op)).toEqual([
      "1",
      "2",
      "3",
    ]);
    const failed = reduceOutbox(
      send(items, "1"),
      { type: "rejected", op: "1", error: error("E_DENIED") },
      options,
    );
    expect(coalesce(failed, () => "key")).toHaveLength(3);
  });

  it("preserves operation accounting, per-key FIFO and cascades across 6000 seeded events", () => {
    const rng = random(1404);
    let items: readonly OutboxItem[] = [];
    const alive = new Set<string>();
    let serial = 0;
    for (let step = 0; step < 6000; step++) {
      const action = rng(9);
      let event: OutboxEvent;
      const target = items[rng(items.length)];
      if (action === 0 || !target) {
        const op = String(++serial);
        alive.add(op);
        event = {
          type: "enqueue",
          item: item(
            op,
            String(rng(8)),
            target && rng(3) === 0 ? [target.op] : undefined,
          ),
        };
      } else if (action === 1) {
        const candidates = nextToSend(items, options);
        for (const candidate of candidates) {
          const index = items.indexOf(candidate);
          expect(
            items.slice(0, index).some((x) => x.args === candidate.args),
          ).toBe(false);
          expect(
            candidate.dependsOn?.some((op) => alive.has(op)) ?? false,
          ).toBe(false);
        }
        const candidate = candidates[rng(candidates.length)];
        event = candidate
          ? { type: "sendStarted", op: candidate.op }
          : { type: "connectionLost" };
      } else if (action === 2 && target.state === "sending") {
        event = { type: "acked", op: target.op };
        alive.delete(target.op);
      } else if (action === 3 && target.state !== "sending") {
        event = { type: "discard", op: target.op };
        alive.delete(target.op);
      } else if (action === 4) event = { type: "retry", op: target.op };
      else if (action === 5)
        event = { type: "rejected", op: target.op, error: error("E_DENIED") };
      else if (action === 6)
        event = {
          type: "transportFailed",
          op: target.op,
          error: error("E_TIMEOUT"),
        };
      else event = { type: "connectionLost" };
      const before = JSON.stringify(items);
      const next = reduceOutbox(items, event, options);
      expect(JSON.stringify(items)).toBe(before);
      items = next;
      expect(new Set(items.map((x) => x.op))).toEqual(alive);
      expect(items.length).toBe(alive.size);
      const sending = items.filter((x) => x.state === "sending");
      expect(sending.length).toBeLessThanOrEqual(options.maxInFlight);
      expect(new Set(sending.map((x) => x.args)).size).toBe(sending.length);
      const failed = new Set(
        items.filter((x) => x.state === "failed").map((x) => x.op),
      );
      for (const queued of items)
        if (
          queued.discardedDependencies?.length ||
          queued.dependsOn?.some((op) => failed.has(op))
        )
          expect(queued.state).toBe("failed");
    }
  });
});
