import { expect, it } from "vitest";
import { time } from "./values.ts";
it("interprets legacy SQLite datetime text as UTC independent of the host timezone", () => {
  expect(time("2020-01-02 00:00:00")).toBe(Date.parse("2020-01-02T00:00:00Z"));
  expect(time("2020-01-02T00:00:00.123")).toBe(
    Date.parse("2020-01-02T00:00:00.123Z"),
  );
  expect(time("2020-01-02T08:00:00+08:00")).toBe(
    Date.parse("2020-01-02T00:00:00Z"),
  );
  expect(time(123)).toBe(123);
  expect(time("broken")).toBe(0);
});
