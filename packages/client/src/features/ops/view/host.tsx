import type { ReactElement } from "react";
import { Group, GroupRow } from "../../../ui/layout/index.ts";
import type { HostController, HostModel } from "../model/host.ts";
import { ActionView } from "./action.tsx";
import { PanelView } from "./panel.tsx";

export function HostView({
  model,
  actions,
}: {
  model: HostModel;
  actions: Pick<HostController, "press" | "confirm" | "dismiss">;
}): ReactElement {
  return (
    <PanelView frame={model.frame} handlers={actions}>
      <Group title="服务器计算机">
        {model.platform && (
          <GroupRow label="平台支持">{model.platform}</GroupRow>
        )}
        {model.actions.map((action) => (
          <GroupRow
            key={action.id}
            label={action.label}
            hint={
              action.id === "shutdown"
                ? "10 秒后关机，将中断所有连接"
                : "请先保存服务器上打开的文档"
            }
          >
            <ActionView
              action={action}
              handlers={actions}
              variant="danger-ghost"
            />
          </GroupRow>
        ))}
      </Group>
    </PanelView>
  );
}
