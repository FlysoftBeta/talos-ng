import { expect, it } from "vitest";
import {
  durationFieldMax,
  durationFields,
  durationWithField,
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

it("splits minutes over the shown units; the largest shown unit holds the excess", () => {
  const all = ["days", "hours", "minutes"] as const;
  expect(durationFields(1440 * 2 + 185, all)).toEqual({
    days: 2,
    hours: 3,
    minutes: 5,
  });
  expect(durationFields(1440 + 90, ["hours", "minutes"])).toEqual({
    days: 0,
    hours: 25,
    minutes: 30,
  });
  // A remainder below the smallest shown unit is not shown.
  expect(durationFields(1440 + 10, ["days", "hours"])).toEqual({
    days: 1,
    hours: 0,
    minutes: 0,
  });
});

it("limits each field and the edited total to the control's maximum", () => {
  const units = ["hours", "minutes"] as const;
  expect(durationFieldMax("hours", units, 24 * 60)).toBe(24);
  expect(durationFieldMax("minutes", units, 24 * 60)).toBe(59);
  expect(durationFieldMax("minutes", ["minutes"], 90)).toBe(90);
  expect(durationWithField(90, units, "minutes", "45", 24 * 60)).toBe(105);
  expect(durationWithField(90, units, "hours", "99", 24 * 60)).toBe(24 * 60);
  // 24 h + 30 min exceeds the maximum and is clamped to it.
  expect(durationWithField(24 * 60, units, "minutes", "30", 24 * 60)).toBe(
    24 * 60,
  );
  expect(
    durationWithField(
      1440 * 2,
      ["days", "hours", "minutes"],
      "hours",
      "5",
      31 * 1440 - 1,
    ),
  ).toBe(1440 * 2 + 300);
});
