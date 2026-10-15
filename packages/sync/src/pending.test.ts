import { AppError } from "@talos/base";
import { describe, expect, it } from "vitest";
import {
  pendingRow,
  rollback,
  settle,
  updateAuthoritative,
  withPending,
} from "./pending.ts";

describe("optimistic pending rows", () => {
  it("restores the authoritative base exactly after rejection", () => {
    const base = { title: "server", nested: { a: 1 }, optional: undefined };
    const initial = pendingRow(base);
    const optimistic = withPending(initial, "1", {
      title: "local",
      nested: { a: 2 },
    });
    expect(optimistic.value.title).toBe("local");
    expect(optimistic.base).toBe(base);
    expect(initial.value).toBe(base);
    expect(rollback(optimistic, "1").value).toBe(base);
  });

  it("rebases all optimistic patches on authoritative updates", () => {
    let row = withPending(pendingRow({ title: "old", count: 0 }), "1", {
      title: "local",
    });
    row = updateAuthoritative(row, { title: "remote", count: 2 });
    expect(row.value).toEqual({ title: "local", count: 2 });
    expect(rollback(row, "1").value).toEqual({ title: "remote", count: 2 });
  });

  it("settles one mark after a delta, retaining later overlapping patches", () => {
    let row = withPending(pendingRow({ title: "base", count: 0 }), "1", {
      title: "first",
    });
    row = withPending(row, "2", { title: "second", count: 3 });
    row = updateAuthoritative(row, { title: "first canonical", count: 1 });
    row = settle(row, "1");
    expect(row.value).toEqual({ title: "second", count: 3 });
    expect(row.pending.map((x) => x.op)).toEqual(["2"]);
    expect(rollback(row, "2").value).toEqual({
      title: "first canonical",
      count: 1,
    });
  });

  it("rolls back marks in either order without promoting optimistic values", () => {
    const row = withPending(
      withPending(pendingRow({ x: 0 }), "1", { x: 1 }),
      "2",
      { x: 2 },
    );
    expect(rollback(row, "2").value).toEqual({ x: 1 });
    expect(rollback(row, "1").value).toEqual({ x: 2 });
    expect(rollback(rollback(row, "1"), "2").value).toBe(row.base);
    expect(settle(row, "unknown")).toEqual(row);
    expect(settle(settle(row, "1"), "1")).toEqual(settle(row, "1"));
  });

  it("copies patch fields and rejects duplicate or empty operation identities", () => {
    const patch = { x: 1 };
    const row = withPending(pendingRow({ x: 0 }), "1", patch);
    patch.x = 2;
    expect(updateAuthoritative(row, { x: 3 }).value).toEqual({ x: 1 });
    expect(() => withPending(row, "1", {})).toThrow(AppError);
    expect(() => withPending(row, "", {})).toThrow(AppError);
  });

  it("supports explicit undefined and prototype-named fields as shallow data", () => {
    const base: { value: number | undefined; constructor: string } = {
      value: 1,
      constructor: "base",
    };
    const row = withPending(pendingRow(base), "1", {
      value: undefined,
      constructor: "local",
    });
    expect(row.value).toEqual({ value: undefined, constructor: "local" });
    expect(rollback(row, "1").value).toBe(base);
  });
});
