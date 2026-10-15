import type { ReactElement } from "react";
import { Button, GridAction } from "../../../ui/actions/index.ts";
import { ConfirmDialog, Sheet } from "../../../ui/overlays/index.ts";
import { DataGrid } from "../../../ui/data-grid/index.ts";
import { Field, Switch } from "../../../ui/inputs/index.ts";
import {
  Inline,
  Group,
  GroupRow,
  Pane,
  Stack,
  PaneHeader,
  PaneBody,
} from "../../../ui/layout/index.ts";
import { Segmented } from "../../../ui/navigation/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import { IDENTITY_SIGNALS, deviceStatus } from "../model/devices.ts";
import type { DevicesController, DevicesState } from "../model/devices.ts";

/** Devices pane: registry grid, identity policy, editor sheet and confirmation. */
export function DevicesView({
  state,
  actions,
}: {
  state: DevicesState;
  actions: DevicesController;
}): ReactElement {
  const { access, list, policy, editing } = state;
  return (
    <Pane className="admin-pane" data-testid="admin.devices">
      <PaneHeader title="设备" subtitle={`共 ${list.data?.total ?? 0} 条`} />
      <PaneBody padded className="admin-body">
        <Stack>
          {state.error && <StatePanel state="error" hint={state.error} />}
          {!access.ok ? (
            <StatePanel state="forbidden" hint={access.reason} />
          ) : list.loading ? (
            <StatePanel state="loading" />
          ) : list.error ? (
            <StatePanel
              state="error"
              hint={list.error}
              action={<Button onClick={actions.refresh}>重试</Button>}
            />
          ) : (
            <DataGrid
              height="fill"
              rows={list.data?.items ?? []}
              rowKey={(row) => row.id}
              ariaLabel="设备列表"
              columns={[
                {
                  id: "id",
                  label: "设备 ID",
                  width: 250,
                  render: (row) => row.id,
                },
                {
                  id: "label",
                  label: "备注",
                  width: 170,
                  render: (row) => row.label || "—",
                },
                {
                  id: "bound",
                  label: "绑定用户",
                  width: 200,
                  render: (row) => row.boundUser || "—",
                },
                {
                  id: "status",
                  label: "状态",
                  width: 160,
                  render: deviceStatus,
                },
                {
                  id: "actions",
                  label: "操作",
                  width: 184,
                  pinned: "end",
                  hideable: false,
                  render: (row) => (
                    <Inline className="admin-grid-actions">
                      <GridAction
                        label="编辑设备"
                        onClick={() => actions.edit(row)}
                      />
                      {!row.persistent && (
                        <GridAction
                          icon="pin"
                          label="保留设备"
                          onClick={() => actions.keep(row)}
                        />
                      )}
                      <GridAction
                        icon={row.locked ? "unlock" : "lock"}
                        label={row.locked ? "解锁设备" : "锁定设备"}
                        onClick={() => actions.toggleLock(row)}
                      />
                      <GridAction
                        label="删除设备"
                        onClick={() => actions.remove(row)}
                      />
                    </Inline>
                  ),
                },
              ]}
              search={{ value: state.query, onChange: actions.setQuery }}
              paging={{
                page: state.page,
                pageSize: 50,
                total: list.data?.total ?? 0,
                onPageChange: actions.setPage,
              }}
            />
          )}
          <Group
            title="设备识别"
            hint="客户端 ID 始终启用；网络或浏览器变化后，附加信号可能需要重新验证。"
          >
            {policy.data && (
              <>
                <GroupRow label="设备白名单">
                  <Switch
                    label={policy.data.whitelist ? "关闭白名单" : "启用白名单"}
                    checked={policy.data.whitelist}
                    onChange={actions.toggleWhitelist}
                  />
                </GroupRow>
                <div role="group" aria-label="设备识别信号">
                  {IDENTITY_SIGNALS.map(([signal, label]) => (
                    <GroupRow key={signal} label={label}>
                      <Switch
                        label={label}
                        checked={policy.data!.identitySignals.includes(signal)}
                        onChange={() => actions.toggleSignal(signal)}
                      />
                    </GroupRow>
                  ))}
                </div>
              </>
            )}
          </Group>
          <Sheet
            open={!!editing}
            title={`编辑设备 ${editing?.label || editing?.id || ""}`}
            onClose={actions.closeEditor}
            footer={
              <>
                <Button onClick={actions.closeEditor}>取消</Button>
                <Button variant="contained" onClick={actions.saveEditor}>
                  保存
                </Button>
              </>
            }
          >
            <Group title="设备信息" className="admin-form">
              <Stack>
                <Field
                  label="备注"
                  value={state.label}
                  onChange={(event) => actions.setLabel(event.target.value)}
                />
                <Field
                  label="绑定用户 ID（留空解除绑定）"
                  value={state.boundUser}
                  onChange={(event) => actions.setBoundUser(event.target.value)}
                />
                <Segmented
                  label="白名单"
                  value={editing?.whitelisted ? "yes" : "no"}
                  options={[
                    { value: "no", label: "普通" },
                    { value: "yes", label: "白名单" },
                  ]}
                  onChange={(value) => actions.setWhitelisted(value === "yes")}
                />
              </Stack>
            </Group>
          </Sheet>
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
