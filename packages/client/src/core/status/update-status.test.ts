import { it, expect, vi } from "vitest";
import { ShellError } from "@talos/shell";
import { toUpdateStatus } from "./update-status.ts";
it("offers application only for a different verified build", () => {
  const apply = vi.fn();
  expect(toUpdateStatus({ kind: "ready", build: "a" }, "a", apply).state).toBe(
    "none",
  );
  const next = toUpdateStatus({ kind: "ready", build: "b" }, "a", apply);
  expect(next.state).toBe("ready");
  next.apply?.();
  expect(apply).toHaveBeenCalledOnce();
});
it("reports byte progress and handles empty files without division by zero", () => {
  expect(
    toUpdateStatus(
      {
        kind: "installing",
        progress: { bytes: 50, totalBytes: 100, completed: 1, total: 2 },
      },
      "a",
      () => {},
    ).progress,
  ).toBe(0.5);
  expect(
    toUpdateStatus(
      {
        kind: "installing",
        progress: { bytes: 0, totalBytes: 0, completed: 0, total: 0 },
      },
      "a",
      () => {},
    ).progress,
  ).toBe(0);
});
it("keeps applying and failure messages explicit", () => {
  expect(toUpdateStatus({ kind: "applying" }, "a", () => {})).toEqual({
    state: "applying",
  });
  expect(
    toUpdateStatus(
      { kind: "failed", error: new ShellError("E_INTEGRITY", "校验失败") },
      "a",
      () => {},
    ),
  ).toEqual({ state: "failed", message: "校验失败" });
  expect(toUpdateStatus({ kind: "none" }, "a", () => {})).toEqual({
    state: "none",
  });
});
