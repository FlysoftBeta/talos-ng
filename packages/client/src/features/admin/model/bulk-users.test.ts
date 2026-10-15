import { describe, expect, it } from "vitest";
import {
  bulkReportCounts,
  bulkReportText,
  bulkRequest,
  emptyBulkEdit,
  hasBulkChange,
} from "./bulk-users.ts";

describe("bulk user edit", () => {
  it("is empty until a choice differs from unchanged", () => {
    const edit = emptyBulkEdit();
    expect(hasBulkChange(edit)).toBe(false);
    expect(hasBulkChange({ ...edit, gates: { ai: "unchanged" } })).toBe(false);
    expect(hasBulkChange({ ...edit, gates: { ai: "enable" } })).toBe(true);
    expect(hasBulkChange({ ...edit, ban: "disable" })).toBe(true);
  });
  it("derives mute and ban deadlines from one restriction length", () => {
    const edit = { ...emptyBulkEdit(), mute: "enable", ban: "enable" } as const;
    expect(bulkRequest(["a"], edit, 60, 1000).changes).toEqual({
      mutedUntil: 1000 + 3_600_000,
      banned: true,
      bannedUntil: 1000 + 3_600_000,
    });
    expect(bulkRequest(["a"], edit, 0, 1000).changes).toEqual({
      mutedUntil: Number.MAX_SAFE_INTEGER,
      banned: true,
      bannedUntil: null,
    });
  });
  it("lifts restrictions without a deadline and omits untouched groups", () => {
    const lift = {
      ...emptyBulkEdit(),
      mute: "disable",
      ban: "disable",
    } as const;
    expect(bulkRequest(["a", "b"], lift, 1440, 5)).toEqual({
      ids: ["a", "b"],
      changes: { mutedUntil: 0, banned: false },
    });
    const gates = { ...emptyBulkEdit(), gates: { ai: "enable" } } as const;
    expect(bulkRequest(["a"], gates, 1440, 5)).toEqual({
      ids: ["a"],
      gateChanges: { ai: "enable" },
    });
  });
  it("counts outcomes and renders the exported report", () => {
    const report = [
      { id: "a", ok: true },
      { id: "b", ok: false, error: "最后一位根管理员" },
      { id: "c", ok: false },
    ];
    expect(bulkReportCounts(report)).toEqual({ succeeded: 1, failed: 2 });
    expect(bulkReportText(report)).toBe(
      "a\t成功\nb\t失败：最后一位根管理员\nc\t失败：未知错误",
    );
  });
});
