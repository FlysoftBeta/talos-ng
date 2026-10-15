import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { ConfirmDialog } from "../../../ui/overlays/index.ts";
import { Field, Switch } from "../../../ui/inputs/index.ts";
import {
  Group,
  GroupRow,
  Pane,
  Stack,
  PaneHeader,
  PaneBody,
} from "../../../ui/layout/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import type { SystemController, SystemState } from "../model/system.ts";

/** System pane: device policy switches and media service policy. */
export function SystemView({
  state,
  actions,
}: {
  state: SystemState;
  actions: SystemController;
}): ReactElement {
  const { access, data } = state;
  const settings = data.data;
  return (
    <Pane className="admin-pane" data-testid="admin.system">
      <PaneHeader title="系统" />
      <PaneBody padded narrow>
        <Stack>
          {!access.permission.ok ? (
            <StatePanel state="forbidden" hint={access.permission.reason} />
          ) : data.loading ? (
            <StatePanel state="loading" />
          ) : data.error ? (
            <StatePanel
              state="error"
              hint={data.error}
              action={<Button onClick={actions.reload}>重试</Button>}
            />
          ) : (
            settings && (
              <>
                {access.policy && (
                  <Group title="设备与访问">
                    <GroupRow label="设备白名单" hint="仅允许白名单设备访问">
                      <Switch
                        label={settings.whitelist ? "关闭白名单" : "启用白名单"}
                        checked={settings.whitelist}
                        onChange={() => actions.toggle("whitelist")}
                      />
                    </GroupRow>
                    <GroupRow label="系统锁" hint="锁定后仅管理员可使用">
                      <Switch
                        label={settings.systemLock ? "解锁系统" : "锁定系统"}
                        checked={settings.systemLock}
                        onChange={() => actions.toggle("systemLock")}
                      />
                    </GroupRow>
                    <GroupRow label="闲置锁" hint="闲置五分钟后锁定">
                      <Switch
                        label={settings.idleLock ? "关闭闲置锁" : "启用闲置锁"}
                        checked={settings.idleLock}
                        onChange={() => actions.toggle("idleLock")}
                      />
                    </GroupRow>
                  </Group>
                )}
                {access.media && (
                  <Group title="媒体服务策略" className="admin-form">
                    <Stack>
                      <Field
                        label={`最大音量（当前 ${settings.maxVolume}）`}
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={state.maxVolume}
                        onChange={(event) =>
                          actions.setMaxVolume(Number(event.target.value))
                        }
                      />
                      <Button variant="primary" onClick={actions.saveMedia}>
                        保存媒体策略
                      </Button>
                    </Stack>
                  </Group>
                )}
              </>
            )
          )}
          {state.error && <StatePanel state="error" hint={state.error} />}
          <ConfirmDialog
            open={!!state.confirm}
            objectName={state.confirm?.label ?? ""}
            onClose={actions.dismissConfirm}
            onConfirm={actions.runConfirmed}
          />
        </Stack>
      </PaneBody>
    </Pane>
  );
}
