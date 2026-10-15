import { describe, expect, expectTypeOf, it } from "vitest";
import { assertNever, invariant } from "./assertions.ts";
import { Emitter } from "./events.ts";
import { createFsm } from "./fsm.ts";
import type { TransitionTable } from "./fsm.ts";
import {
  AppError,
  ERROR_CODES,
  err,
  isAppError,
  mapResult,
  ok,
  unwrap,
} from "./errors.ts";
describe("errors and results", () => {
  it("roundtrips every wire code, preserves data, and validates untrusted JSON", () => {
    expect(new Set(ERROR_CODES).size).toBe(18);
    for (const code of ERROR_CODES) {
      const error = new AppError(code, "错误", { x: 1 });
      const copy = AppError.fromJSON(JSON.parse(JSON.stringify(error)));
      expect(copy).toBeInstanceOf(Error);
      expect(copy.toJSON()).toEqual(error.toJSON());
      expect(copy.name).toBe("AppError");
      expect(isAppError(copy)).toBe(true);
    }
    expect(new AppError("E_INTERNAL", "x").toJSON()).toEqual({
      code: "E_INTERNAL",
      message: "x",
    });
    expect(isAppError({ code: "E_INTERNAL", message: "x" })).toBe(false);
    for (const value of [
      null,
      1,
      {},
      { code: "UNKNOWN", message: "x" },
      { code: "E_INTERNAL", message: 1 },
    ])
      expect(() => AppError.fromJSON(value)).toThrow();
  });
  it("constructs, maps and unwraps discriminated results", () => {
    expect(unwrap(mapResult(ok(2), (x) => String(x)))).toBe("2");
    const error = new AppError("E_INVALID", "错误");
    const result = err<number>(error);
    expect(mapResult(result, String)).toBe(result);
    expect(() => unwrap(result)).toThrow(error);
    if (result.ok) expectTypeOf(result.value).toEqualTypeOf<number>();
    else expectTypeOf(result.error).toEqualTypeOf<AppError>();
  });
});
describe("events, invariants and FSM", () => {
  it("isolates listeners and reporters; unsubscribe is idempotent and delivery is a snapshot", () => {
    const seen: number[] = [];
    const errors: unknown[] = [];
    const emitter = new Emitter<number>((e) => {
      errors.push(e);
      throw new Error();
    });
    const off = emitter.on((n) => {
      seen.push(n);
    });
    emitter.on(() => {
      off();
      throw new Error("listener");
    });
    emitter.on((n) => {
      seen.push(n * 10);
    });
    emitter.emit(2);
    off();
    off();
    emitter.emit(3);
    expect(seen).toEqual([2, 20, 30]);
    expect(errors).toHaveLength(2);
    emitter.clear();
    emitter.emit(4);
    expect(seen).toEqual([2, 20, 30]);
  });
  it("narrows invariants and rejects impossible values", () => {
    const value: unknown = "x";
    invariant(typeof value === "string");
    expectTypeOf(value).toEqualTypeOf<string>();
    expect(() => invariant(false, "broken")).toThrow("broken");
    expect(() => assertNever("x" as never)).toThrow("Unexpected value: x");
  });
  it("types every state/event cell and reports accepted transitions after state changes", () => {
    type State = "idle" | "open";
    type Event = "start" | "stop";
    const transitions: TransitionTable<State, Event> = {
      idle: { start: "open", stop: null },
      open: { start: null, stop: "idle" },
    };
    const seen: string[] = [];
    const fsm = createFsm<State, Event>({
      initial: "idle",
      transitions,
      onTransition: ({ to }) => {
        seen.push(to);
      },
    });
    const off = fsm.onTransition(({ to }) => {
      expect(fsm.state).toBe(to);
    });
    expect(fsm.send("stop")).toBe(false);
    expect(fsm.send("start")).toBe(true);
    expect(fsm.state).toBe("open");
    expect(fsm.send("start")).toBe(false);
    off();
    expect(fsm.send("stop")).toBe(true);
    expect(seen).toEqual(["open", "idle"]);
    if (false) {
      // @ts-expect-error Invalid events are rejected at compile time.
      fsm.send("other");
      const incomplete: TransitionTable<State, Event> = {
        // @ts-expect-error Every event must be explicitly handled, including rejected transitions.
        idle: { start: "open" },
        open: { start: null, stop: "idle" },
      };
      void incomplete;
    }
  });
});
