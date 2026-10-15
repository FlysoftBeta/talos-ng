import type { AdminRole, ArgsOf, Feature } from "@talos/contract";
import type { contract } from "@talos/contract";
import { durationUntil } from "./duration.ts";

export type Tri = "unchanged" | "enable" | "disable";
export const TRI_OPTIONS: readonly Tri[] = ["unchanged", "enable", "disable"];
export const triLabels: Record<Tri, string> = {
  unchanged: "不变",
  enable: "启用",
  disable: "禁用",
};

/** Tri-state edits applied to every selected user. */
export interface BulkEdit {
  gates: Partial<Record<Feature, Tri>>;
  roles: Partial<Record<AdminRole, Tri>>;
  mute: Tri;
  ban: Tri;
}
export const emptyBulkEdit = (): BulkEdit => ({
  gates: {},
  roles: {},
  mute: "unchanged",
  ban: "unchanged",
});

/** Applying is offered once any entitlement, role, mute or ban choice differs from "unchanged". */
export function hasBulkChange(edit: BulkEdit): boolean {
  return (
    Object.values(edit.gates).some((v) => v !== "unchanged") ||
    Object.values(edit.roles).some((v) => v !== "unchanged") ||
    edit.mute !== "unchanged" ||
    edit.ban !== "unchanged"
  );
}
/** The duration control is relevant only while a mute or ban is being switched on. */
export function bulkNeedsDuration(edit: BulkEdit): boolean {
  return edit.mute === "enable" || edit.ban === "enable";
}

/** Contract request for the selected users; the restriction length is shared by mute and ban. */
export function bulkRequest(
  ids: readonly string[],
  edit: BulkEdit,
  durationMinutes: number,
  now: number,
): ArgsOf<typeof contract.admin.user.bulk> {
  const changes = {
    ...(edit.mute !== "unchanged"
      ? {
          mutedUntil:
            edit.mute === "enable" ? durationUntil(durationMinutes, now) : 0,
        }
      : {}),
    ...(edit.ban !== "unchanged"
      ? {
          banned: edit.ban === "enable",
          ...(edit.ban === "enable"
            ? {
                bannedUntil:
                  durationMinutes === 0
                    ? null
                    : durationUntil(durationMinutes, now),
              }
            : {}),
        }
      : {}),
  };
  return {
    ids: [...ids],
    ...(Object.keys(changes).length ? { changes } : {}),
    ...(Object.keys(edit.gates).length ? { gateChanges: edit.gates } : {}),
    ...(Object.keys(edit.roles).length ? { roleChanges: edit.roles } : {}),
  };
}

export interface BulkReportItem {
  id: string;
  ok: boolean;
  error?: string;
}
export function bulkReportCounts(report: readonly BulkReportItem[]): {
  succeeded: number;
  failed: number;
} {
  const failed = report.filter((item) => !item.ok).length;
  return { succeeded: report.length - failed, failed };
}
/** Tab-separated per-user outcome for the exported report. */
export function bulkReportText(report: readonly BulkReportItem[]): string {
  return report
    .map(
      (item) =>
        `${item.id}\t${item.ok ? "成功" : `失败：${item.error ?? "未知错误"}`}`,
    )
    .join("\n");
}
