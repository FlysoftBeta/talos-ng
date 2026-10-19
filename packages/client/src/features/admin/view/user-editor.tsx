import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { Sheet } from "../../../ui/overlays/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import { Checkbox, Field } from "../../../ui/inputs/index.ts";
import { Group, Stack } from "../../../ui/layout/index.ts";
import { FEATURE_OPTIONS, ROLE_OPTIONS } from "../model/access.ts";
import type { UsersController, UsersState } from "../model/users.ts";

/** Create / edit dialog: profile, PIN, roles and entitlements. */
export function UserEditorDialog({
  state,
  canSave,
  actions,
}: {
  state: UsersState;
  canSave: boolean;
  actions: UsersController;
}): ReactElement {
  const { editing, access } = state;
  return (
    <Sheet
      open={!!editing}
      title={editing === "new" ? "创建用户" : `编辑用户：${editing?.name}`}
      onClose={actions.cancelEdit}
      footer={
        <>
          <Button onClick={actions.cancelEdit}>取消</Button>
          <Button
            variant="contained"
            disabled={!canSave}
            onClick={() => void actions.save()}
          >
            保存
          </Button>
        </>
      }
    >
      <Stack>
        {(editing === "new" || access.profile) && (
          <>
            <Field
              label="账号"
              value={state.handle}
              onChange={(event) => actions.setHandle(event.target.value)}
            />
            <Field
              label="姓名"
              value={state.name}
              onChange={(event) => actions.setName(event.target.value)}
            />
          </>
        )}
        {(editing === "new" || access.credential) && (
          <Field
            label={editing === "new" ? "六位 PIN" : "重置 PIN（留空保持）"}
            type="password"
            value={state.pin}
            onChange={(event) => actions.setPin(event.target.value)}
          />
        )}
        {editing !== "new" && access.roles && (
          <Group title="管理角色" className="admin-permissions">
            {ROLE_OPTIONS.map((role) => (
              <Checkbox
                key={role.value}
                label={role.label}
                type="checkbox"
                checked={state.roles.includes(role.value)}
                onChange={(event) =>
                  actions.setRole(role.value, event.target.checked)
                }
              />
            ))}
          </Group>
        )}
        {access.features && (
          <Group title="产品权限" className="admin-permissions">
            {FEATURE_OPTIONS.map((feature) => (
              <Checkbox
                key={feature.value}
                label={feature.label}
                type="checkbox"
                checked={state.features.includes(feature.value)}
                onChange={(event) =>
                  actions.setFeature(feature.value, event.target.checked)
                }
              />
            ))}
          </Group>
        )}
        {state.error && <StatePanel state="error" hint={state.error} />}
      </Stack>
    </Sheet>
  );
}
