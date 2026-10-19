import { expect, it } from "vitest";
import { durationUntil } from "./duration.ts";

it("restriction deadlines: zero minutes is permanent", () => {
  expect(durationUntil(0, 5)).toBe(Number.MAX_SAFE_INTEGER);
  expect(durationUntil(10, 1000)).toBe(1000 + 600_000);
});
