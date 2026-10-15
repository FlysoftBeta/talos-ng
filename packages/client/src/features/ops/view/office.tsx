import type { ReactElement } from "react";
import { Group, GroupRow } from "../../../ui/layout/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import type { OfficeController, OfficeModel } from "../model/office.ts";
import { ActionMenu, ActionView } from "./action.tsx";
import { PanelView } from "./panel.tsx";

export function OfficeView({
  model,
  actions,
}: {
  model: OfficeModel;
  actions: Pick<OfficeController, "press" | "confirm" | "dismiss">;
}): ReactElement {
  return (
    <PanelView frame={model.frame} handlers={actions}>
      <Group title="文档捕获">
        {model.toolbar.map((action, i) => (
          <GroupRow
            key={action.id}
            label={i === 0 ? "捕获已保存的文档副本" : "清理捕获副本"}
          >
            <ActionView
              action={action}
              handlers={actions}
              variant={i === 0 ? "primary" : "danger-ghost"}
            />
          </GroupRow>
        ))}
      </Group>
      <Group title="捕获记录">
        {model.empty ? (
          <StatePanel
            state="empty"
            title={model.empty.title}
            hint={model.empty.hint}
          />
        ) : (
          model.rows.map((row) => (
            <GroupRow key={row.id} label={row.title} hint={row.hint}>
              <ActionMenu
                label={`文档 ${row.title} 的操作`}
                actions={[row.download]}
                handlers={actions}
              />
            </GroupRow>
          ))
        )}
      </Group>
    </PanelView>
  );
}
