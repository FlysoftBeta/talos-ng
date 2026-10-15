import type { ReactElement } from "react";
import { Field, Switch } from "../../../ui/inputs/index.ts";
import { Group, GroupRow } from "../../../ui/layout/index.ts";
import { OfflineHint, StatePanel } from "../../../ui/feedback/index.ts";
import type { BackupController, BackupModel } from "../model/backup.ts";
import { ActionMenu, ActionView } from "./action.tsx";
import { PanelView } from "./panel.tsx";

export type BackupActions = Pick<
  BackupController,
  "press" | "confirm" | "dismiss" | "setRetention" | "setDaily"
>;
export function BackupView({
  model,
  actions,
}: {
  model: BackupModel;
  actions: BackupActions;
}): ReactElement {
  const { settings } = model;
  return (
    <PanelView frame={model.frame} handlers={actions}>
      <Group title="完整备份">
        <GroupRow label="数据库与文档" hint="默认保留 5 份">
          <ActionView
            action={model.create}
            handlers={actions}
            variant="primary"
          />
        </GroupRow>
      </Group>
      {settings && (
        <Group title="备份设置">
          <GroupRow label="保留策略" stacked>
            <OfflineHint
              label="保留份数"
              reason={
                !settings.editable
                  ? settings.save.reason || "无权限"
                  : undefined
              }
            >
              <Field
                label="保留份数"
                type="number"
                min={1}
                max={100}
                disabled={!settings.editable}
                value={settings.draft.retention}
                onChange={(e) => actions.setRetention(Number(e.target.value))}
              />
            </OfflineHint>
          </GroupRow>
          <GroupRow label="每天自动备份" hint="北京时间">
            <OfflineHint
              label="每天自动备份（北京时间）"
              reason={
                !settings.editable
                  ? settings.save.reason || "无权限"
                  : undefined
              }
            >
              <Switch
                label="每天自动备份（北京时间）"
                checked={settings.draft.daily}
                disabled={!settings.editable}
                onChange={actions.setDaily}
              />
            </OfflineHint>
          </GroupRow>
          <GroupRow label="保存设置">
            <ActionView action={settings.save} handlers={actions} />
          </GroupRow>
        </Group>
      )}
      <Group title="备份记录">
        {model.rows?.length === 0 ? (
          <StatePanel
            state="empty"
            title="尚无备份"
            hint="创建第一份完整备份，以便恢复数据库和文档。"
          />
        ) : (
          model.rows?.map((row) => (
            <GroupRow key={row.record.id} label={row.title} hint={row.hint}>
              <ActionMenu
                label={`备份 ${row.title} 的操作`}
                actions={[row.download, row.remove]}
                handlers={actions}
              />
            </GroupRow>
          ))
        )}
      </Group>
    </PanelView>
  );
}
