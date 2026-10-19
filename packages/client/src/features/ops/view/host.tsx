import type { ReactElement } from "react";
import { DurationInput } from "../../../ui/inputs/index.ts";
import type { DurationPreset } from "../../../ui/inputs/index.ts";
import { Group, GroupRow } from "../../../ui/layout/index.ts";
import type { HostController, HostModel } from "../model/host.ts";
import { ActionView } from "./action.tsx";
import { PanelView } from "./panel.tsx";

const SHUTDOWN_PRESETS: readonly DurationPreset[] = [
  { minutes: 10, label: "10 分钟" },
  { minutes: 30, label: "30 分钟" },
  { minutes: 45, label: "45 分钟" },
  { minutes: 60, label: "1 小时" },
  { minutes: 120, label: "2 小时" },
];

export function HostView({
  model,
  actions,
}: {
  model: HostModel;
  actions: Pick<HostController, "press" | "confirm" | "dismiss" | "setDelay">;
}): ReactElement {
  return (
    <PanelView frame={model.frame} handlers={actions}>
      <Group title="服务器计算机">
        {model.platform && (
          <GroupRow label="平台支持">{model.platform}</GroupRow>
        )}
        <GroupRow
          label={model.reset.label}
          hint="关闭打开的文件夹（桌面保留）、Office、WPS、希沃白板和视频展台"
        >
          <ActionView
            action={model.reset}
            handlers={actions}
            variant="danger-ghost"
          />
        </GroupRow>
        <GroupRow
          label={model.shutdown.label}
          hint="10 秒后关机，将中断所有连接"
        >
          <ActionView
            action={model.shutdown}
            handlers={actions}
            variant="danger-ghost"
          />
        </GroupRow>
      </Group>
      <Group title="定时关机">
        <GroupRow
          label="关机时间"
          hint="从现在起经过的时间，最长 24 小时"
          stacked
        >
          <DurationInput
            minutes={model.delay}
            onChange={actions.setDelay}
            units={["hours", "minutes"]}
            max={model.maxDelay}
            presets={SHUTDOWN_PRESETS}
          />
        </GroupRow>
        {model.scheduled && (
          <GroupRow label="已安排">{model.scheduled}</GroupRow>
        )}
        <GroupRow label={model.schedule.label} hint="新的安排会替换已有的安排">
          <ActionView
            action={model.schedule}
            handlers={actions}
            variant="danger-ghost"
          />
        </GroupRow>
        <GroupRow label={model.cancel.label}>
          <ActionView action={model.cancel} handlers={actions} />
        </GroupRow>
      </Group>
    </PanelView>
  );
}
