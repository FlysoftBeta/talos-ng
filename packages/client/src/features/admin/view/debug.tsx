import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import {
  Group,
  GroupRow,
  Pane,
  PaneHeader,
  PaneBody,
} from "../../../ui/layout/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";

export function DebugView({
  root,
  device,
  connection,
  offline,
  onToggle,
}: {
  root: boolean;
  device: string | undefined;
  connection: string;
  offline: boolean;
  onToggle: () => void;
}): ReactElement {
  if (!root)
    return <StatePanel state="forbidden" hint="仅根管理员可使用调试控制" />;
  return (
    <Pane className="admin-pane" data-testid="admin.debug">
      <PaneHeader title="调试" />
      <PaneBody padded narrow>
        <Group title="运行状态">
          <GroupRow label="当前设备">{device ?? "—"}</GroupRow>
          <GroupRow label="连接">{connection}</GroupRow>
          <GroupRow label="模拟离线" hint="仅影响当前会话">
            <Button onClick={onToggle}>
              {offline ? "取消强制离线" : "强制离线"}
            </Button>
          </GroupRow>
        </Group>
      </PaneBody>
    </Pane>
  );
}
