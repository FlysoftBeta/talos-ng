import type { ReactElement } from "react";
import { Field, FileField } from "../../../ui/inputs/index.ts";
import {
  Group,
  GroupRow,
  Inline,
  Stack,
  Tag,
} from "../../../ui/layout/index.ts";
import {
  InlineNotice,
  Mark,
  OfflineHint,
  Progress,
} from "../../../ui/feedback/index.ts";
import type { UpdateController, UpdateModel } from "../model/update.ts";
import { ActionView } from "./action.tsx";
import { PanelView } from "./panel.tsx";

export type UpdateActions = Pick<
  UpdateController,
  "press" | "confirm" | "dismiss" | "setManifestUrl"
>;
export function UpdateView({
  model,
  actions,
  onFile,
}: {
  model: UpdateModel;
  actions: UpdateActions;
  onFile: (file: File | undefined) => void;
}): ReactElement {
  const { cloud } = model;
  return (
    <PanelView frame={model.frame} handlers={actions}>
      <Group title="版本状态">
        <GroupRow label="当前与候选版本" stacked>
          <Inline>
            {model.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Inline>
        </GroupRow>
        {model.lastError && (
          <GroupRow label="更新失败" stacked>
            <InlineNotice tone="failed">{model.lastError}</InlineNotice>
          </GroupRow>
        )}
        <GroupRow label="应用更新" hint="准备完成后重启服务器">
          <ActionView action={model.apply} handlers={actions} />
        </GroupRow>
        <GroupRow
          label="确认运行正常"
          hint="重启后三分钟内确认，逾期自动恢复上一版本"
        >
          <ActionView action={model.confirm} handlers={actions} />
        </GroupRow>
      </Group>
      <Group title="本地更新包">
        <GroupRow label="上传更新包" stacked>
          <Stack>
            <OfflineHint
              label="选择更新包"
              reason={
                !model.uploadEnabled
                  ? model.stage.reason || "无权限"
                  : undefined
              }
            >
              <FileField
                label="选择更新包（对应平台的 -update.zip）"
                accept=".zip"
                disabled={!model.uploadEnabled}
                onFile={onFile}
              />
            </OfflineHint>
            {model.progressPercent !== undefined && (
              <Stack space={2}>
                <Mark
                  state={
                    model.stage.busy
                      ? "pending"
                      : model.stage.error
                        ? "failed"
                        : "confirmed"
                  }
                  label={`上传进度 ${model.progressPercent}%`}
                />
                <Progress
                  label="更新包上传进度"
                  value={model.progressPercent / 100}
                />
              </Stack>
            )}
            <ActionView
              action={model.stage}
              handlers={actions}
              variant="primary"
            />
          </Stack>
        </GroupRow>
      </Group>
      {cloud && (
        <Group title="云端更新">
          <GroupRow label="更新来源" stacked>
            <OfflineHint
              label="云端更新清单地址"
              reason={
                !cloud.editable ? cloud.toggle.reason || "无权限" : undefined
              }
            >
              <Field
                label="云端更新清单地址（HTTPS）"
                disabled={!cloud.editable}
                value={cloud.manifestUrl}
                onChange={(e) => actions.setManifestUrl(e.target.value)}
              />
            </OfflineHint>
          </GroupRow>
          <GroupRow label="云端更新设置" stacked>
            <Inline>
              <ActionView action={cloud.toggle} handlers={actions} />
              <ActionView action={cloud.autoCheck} handlers={actions} />
            </Inline>
          </GroupRow>
          <GroupRow label="检查与准备" stacked>
            <Inline>
              <ActionView action={cloud.check} handlers={actions} />
              <ActionView action={cloud.install} handlers={actions} />
            </Inline>
          </GroupRow>
        </Group>
      )}
    </PanelView>
  );
}
