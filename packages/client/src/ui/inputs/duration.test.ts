import { expect, it } from "vitest";
import { parseDurationPart } from "./duration.ts";

it("clamps typed duration parts to whole numbers within range", () => {
  expect(parseDurationPart("7", 30)).toBe(7);
  expect(parseDurationPart("2.9", 30)).toBe(2);
  expect(parseDurationPart("-3", 30)).toBe(0);
  expect(parseDurationPart("99", 23)).toBe(23);
  expect(parseDurationPart("", 23)).toBe(0);
  expect(parseDurationPart("abc", 23)).toBe(0);
});
