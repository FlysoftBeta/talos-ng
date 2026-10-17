import { AppError } from "@talos/base";
import { describe, expect, it } from "vitest";
import { selectDelta } from "./delta.ts";
import type { Row } from "./delta.ts";

const row = (id: number, rev = id, type = "post", deleted = false): Row => ({
  type,
  id: String(id),
  rev,
  deleted,
  data: { seq: id, value: rev },
});

describe("server delta selection", () => {
  it("never splits a revision group and resumes exclusively after its cursor", () => {
    const rows = [row(1, 1), row(2, 2), row(3, 2), row(4, 2), row(5, 3)];
    const first = selectDelta(rows, 0, 2);
    expect(first).toEqual({ rows: rows.slice(0, 4), cursor: 2, more: true });
    expect(selectDelta(rows, first.cursor, 1)).toEqual({
      rows: [rows[4]],
      cursor: 3,
      more: false,
    });
    expect(selectDelta(rows, 100, 1)).toEqual({
      rows: [],
      cursor: 100,
      more: false,
    });
    expect(selectDelta([], 0, 1)).toEqual({ rows: [], cursor: 0, more: false });
  });

  it("rejects unsorted rows, invalid revisions, and invalid limits", () => {
    expect(() => selectDelta([row(2), row(1)], 0, 1)).toThrow(AppError);
    expect(() => selectDelta([row(1, -1)], 0, 1)).toThrow(AppError);
    for (const limit of [0, -1, NaN, Infinity, 0.5])
      expect(() => selectDelta([], 0, limit)).toThrow(AppError);
  });
});
