import type { ReactElement } from "react";
import { Mark } from "../../../ui/feedback/index.ts";
import { Button } from "../../../ui/actions/index.ts";
import { Dialog, Sheet } from "../../../ui/overlays/index.ts";
import { DurationInput } from "../../../ui/inputs/index.ts";
import { Group, GroupRow, Stack } from "../../../ui/layout/index.ts";
import { FEATURE_OPTIONS, ROLE_OPTIONS } from "../model/access.ts";
import type { BulkReportItem } from "../model/bulk-users.ts";
import type { DurationInputProps } from "../model/duration.ts";
import type { UsersController, UsersState } from "../model/users.ts";
import { TriState } from "./tri-state.tsx";

/** Tri-state bulk edit sheet for the selected users. */
export function BulkUsersSheet({
  state,
  duration,
  needsDuration,
  canApply,
  actions,
}: {
  state: UsersState;
  duration: DurationInputProps;
  needsDuration: boolean;
  canApply: boolean;
  actions: UsersController;
}): ReactElement {
  const { access, bulk } = state;
  return (
    <Sheet
      open={state.bulkOpen}
      title={`批量编辑 ${state.selected.size} 位用户`}
      onClose={actions.closeBulk}
      footer={
        <>
          <Button onClick={actions.closeBulk}>取消</Button>
          <Button
            variant="contained"
            disabled={!canApply}
            onClick={actions.applyBulk}
          >
            应用到所选用户
          </Button>
        </>
      }
    >
      <Stack>
        {access.features && (
          <Group title="产品权限">
            {FEATURE_OPTIONS.map((feature) => (
              <div
                key={feature.value}
                className="admin-bulk-field"
                data-testid="admin.users.bulk.field"
              >
                <span>{feature.label}</span>
                <TriState
                  value={bulk.gates[feature.value] ?? "unchanged"}
                  onChange={(value) => actions.setGate(feature.value, value)}
                />
              </div>
            ))}
          </Group>
        )}
        {access.roles && (
          <Group title="管理角色">
            {ROLE_OPTIONS.map((role) => (
              <div
                key={role.value}
                className="admin-bulk-field"
                data-testid="admin.users.bulk.field"
              >
                <span>{role.label}</span>
                <TriState
                  value={bulk.roles[role.value] ?? "unchanged"}
                  onChange={(value) => actions.setRoleChange(role.value, value)}
                />
              </div>
            ))}
          </Group>
        )}
        {access.restrict && (
          <>
            <div
              className="admin-bulk-field"
              data-testid="admin.users.bulk.field"
            >
              <span>禁言</span>
              <TriState value={bulk.mute} onChange={actions.setBulkMute} />
            </div>
            <div
              className="admin-bulk-field"
              data-testid="admin.users.bulk.field"
            >
              <span>封禁</span>
              <TriState value={bulk.ban} onChange={actions.setBulkBan} />
            </div>
            {needsDuration && <DurationInput {...duration} />}
          </>
        )}
      </Stack>
    </Sheet>
  );
}

/** Per-user outcome of a bulk edit, with a text export callback. */
export function BulkReportDialog({
  report,
  counts,
  onClose,
  onExport,
}: {
  report: readonly BulkReportItem[] | undefined;
  counts: { succeeded: number; failed: number };
  onClose: () => void;
  onExport: () => void;
}): ReactElement {
  return (
    <Dialog
      open={!!report}
      title="批量结果"
      onClose={onClose}
      footer={<Button onClick={onExport}>导出文本</Button>}
    >
      <div role="status" data-testid="admin.users.bulk.report">
        <h2>
          批量结果：成功 {counts.succeeded}，失败 {counts.failed}
        </h2>
        {(report ?? []).map((item) => (
          <GroupRow key={item.id} label={item.id} hint={item.error}>
            <Mark
              state={item.ok ? "confirmed" : "failed"}
              label={item.ok ? "成功" : "失败"}
            />
          </GroupRow>
        ))}
      </div>
    </Dialog>
  );
}
