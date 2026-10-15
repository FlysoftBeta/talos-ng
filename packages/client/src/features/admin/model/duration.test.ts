import { expect, it, vi } from "vitest";
import {
  durationInputProps,
  durationMinutes,
  durationParts,
  durationUntil,
  parseDurationPart,
} from "./duration.ts";

it("clamps typed duration parts to whole numbers within range", () => {
  expect(parseDurationPart("7", 30)).toBe(7);
  expect(parseDurationPart("2.9", 30)).toBe(2);
  expect(parseDurationPart("-3", 30)).toBe(0);
  expect(parseDurationPart("99", 23)).toBe(23);
  expect(parseDurationPart("", 23)).toBe(0);
  expect(parseDurationPart("abc", 23)).toBe(0);
});

it("converts between minutes and day/hour fields; zero minutes is permanent", () => {
  expect(durationParts(1440 * 2 + 180)).toEqual({ days: 2, hours: 3 });
  expect(durationMinutes(2, 3)).toBe(2 * 1440 + 180);
  expect(durationUntil(0, 5)).toBe(Number.MAX_SAFE_INTEGER);
  expect(durationUntil(10, 1000)).toBe(1000 + 600_000);
  const set = vi.fn();
  const props = durationInputProps(90, set);
  expect(props).toMatchObject({ days: 0, hours: 1, preset: 90 });
  props.onChange(1, 2);
  expect(set).toHaveBeenCalledWith(1440 + 120);
});
