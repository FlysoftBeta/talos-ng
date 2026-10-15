import { describe, expect, it } from "vitest";
import { chatDay, chatListTime, dateLabel } from "./format.ts";

// Chat days are Asia/Shanghai calendar days (UTC+8, no DST), independent of the host zone.
const midnight = Date.parse("2025-12-31T16:00:00Z"); // 2026-01-01 00:00 Shanghai

describe("chat day labels", () => {
  it("rolls the day exactly at Shanghai midnight", () => {
    expect(chatDay(midnight - 1)).toBe("2025-12-31");
    expect(chatDay(midnight)).toBe("2026-01-01");
  });
  it.each([
    [midnight, midnight, "今天"],
    [midnight - 1, midnight, "昨天"],
    [midnight - 86_400_001, midnight, "12月30日"],
    // leap day: 29 Feb 2024 23:59:59 Shanghai is still "yesterday" one second later
    [
      Date.parse("2024-02-29T15:59:59Z"),
      Date.parse("2024-02-29T16:00:00Z"),
      "昨天",
    ],
    [
      Date.parse("2024-02-28T16:00:00Z"),
      Date.parse("2024-03-01T04:00:00Z"),
      "昨天",
    ],
  ] as const)("labels %i against %i as %s", (value, now, expected) =>
    expect(dateLabel(value, now)).toBe(expected),
  );
  it("shows time today, 昨天, then month/day in the list", () => {
    const now = Date.parse("2026-03-10T08:30:00Z"); // 16:30 Shanghai
    expect(chatListTime(Date.parse("2026-03-10T01:05:00Z"), now)).toBe("09:05");
    expect(chatListTime(Date.parse("2026-03-09T20:00:00Z"), now)).toBe("04:00");
    expect(chatListTime(Date.parse("2026-03-09T10:00:00Z"), now)).toBe("昨天");
    expect(chatListTime(Date.parse("2026-03-01T10:00:00Z"), now)).toBe("3/1");
  });
});
