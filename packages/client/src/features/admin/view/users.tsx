import type { ReactElement, ReactNode } from "react";
import { Button, GridAction } from "../../../ui/actions/index.ts";
import { ConfirmDialog } from "../../../ui/overlays/index.ts";
import { DataGrid, SelectionActionBar } from "../../../ui/data-grid/index.ts";
import {
  HelpTip,
  OfflineHint,
  StatePanel,
} from "../../../ui/feedback/index.ts";
import {
  Inline,
  Pane,
  PaneHeader,
  PaneBody,
} from "../../../ui/layout/index.ts";
import type { UserRow, UsersController, UsersState } from "../model/users.ts";

/** Users pane: list, selection bar and confirmation; dialogs and sheets arrive as `children`. */
export function UsersView({
  state,
  rows,
  actions,
  children,
}: {
  state: UsersState;
  rows: readonly UserRow[];
  actions: UsersController;
  children: ReactNode;
}): ReactElement {
  const { access, list, selected } = state;
  return (
    <Pane className="admin-pane" data-testid="admin.users">
      <PaneHeader
        title="用户"
        subtitle={`共 ${list.data?.total ?? 0} 条`}
        actions={
          <>
            {" "}
            <HelpTip text="管理操作按职责授权。批量编辑逐人执行并显示失败项；批量分配 AI 额度可重试失败项。禁言支持预设或自定义天数与小时。" />
            <OfflineHint
              label="创建用户"
              reason={access.canCreate ? undefined : "当前账号无权创建用户"}
            >
              <Button
                variant="contained"
                disabled={!access.canCreate}
                onClick={() => actions.begin("new")}
              >
                创建用户
              </Button>
            </OfflineHint>{" "}
          </>
        }
      />
      <PaneBody padded className="admin-body">
        {selected.size > 0 &&
          (access.restrict || access.features || access.roles) && (
            <SelectionActionBar
              count={selected.size}
              onClear={actions.clearSelection}
            >
              <Button disabled={!access.bulk.ok} onClick={actions.openBulk}>
                批量编辑
              </Button>
              {access.features && (
                <Button onClick={actions.openCredit}>批量分配 AI 额度</Button>
              )}
            </SelectionActionBar>
          )}
        {!access.list.ok ? (
          <StatePanel state="forbidden" hint={access.list.reason} />
        ) : list.loading ? (
          <StatePanel state="loading" />
        ) : list.error ? (
          <StatePanel
            state="error"
            hint={list.error}
            action={<Button onClick={actions.reload}>重试</Button>}
          />
        ) : (
          <DataGrid
            height="fill"
            rows={rows}
            rowKey={(row) => row.user.id}
            ariaLabel="用户列表"
            testId="admin.users.grid"
            columns={[
              {
                id: "handle",
                label: "账号",
                width: 140,
                sortable: true,
                render: (row) => row.user.handle,
              },
              {
                id: "name",
                label: "姓名",
                width: 180,
                sortable: true,
                render: (row) => row.user.name,
              },
              {
                id: "roles",
                label: "管理角色",
                width: 240,
                render: (row) => row.roleLabel || "普通用户",
                longText: (row) => row.roleLabel,
              },
              {
                id: "status",
                label: "状态",
                width: 150,
                render: (row) => row.status,
              },
              {
                id: "actions",
                label: "操作",
                width: 220,
                pinned: "end",
                hideable: false,
                render: (row) => (
                  <Inline className="admin-grid-actions">
                    <GridAction
                      label="编辑用户"
                      disabled={!row.canEdit}
                      onClick={() => actions.begin(row.user)}
                    />
                    <GridAction
                      icon={row.user.banned ? "unlock" : "lock"}
                      label={row.user.banned ? "解封" : "封禁"}
                      disabled={!row.canRestrict}
                      onClick={() => actions.askBan(row.user)}
                    />
                    <GridAction
                      icon={row.muted ? "bell" : "mute"}
                      label={row.muted ? "解除禁言" : "禁言"}
                      disabled={!row.canRestrict}
                      onClick={() => actions.askMute(row.user)}
                    />
                    <GridAction
                      icon="xcircle"
                      label="停用用户"
                      disabled={!row.canDeactivate}
                      onClick={() => actions.deactivate(row.user)}
                    />
                    <GridAction
                      label="永久清除用户"
                      disabled={!row.canPurge}
                      onClick={() => actions.purge(row.user)}
                    />
                  </Inline>
                ),
              },
            ]}
            selection={{
              selectedKeys: selected,
              onChange: actions.setSelected,
            }}
            search={{
              value: state.query,
              onChange: actions.setQuery,
              placeholder: "搜索账号或姓名",
            }}
            sort={{
              columnId: state.sort,
              direction: "asc",
              onChange: actions.sortBy,
            }}
            paging={{
              page: state.page,
              pageSize: 50,
              total: list.data?.total ?? 0,
              onPageChange: actions.setPage,
            }}
          />
        )}

        {children}
        <ConfirmDialog
          open={!!state.confirm}
          title="确认管理操作"
          confirmLabel="确认"
          destructive={
            state.confirm?.label.startsWith("永久清除") ||
            state.confirm?.label.startsWith("停用")
          }
          message={
            state.confirm
              ? `${state.confirm.label}。${state.confirm.label.startsWith("永久清除") ? "删除后无法恢复。" : "确认后将执行此操作。"}`
              : undefined
          }
          objectName={state.confirm?.label ?? ""}
          onClose={actions.dismissConfirm}
          onConfirm={actions.runConfirmed}
        />
        {!state.editing && state.error && (
          <StatePanel state="error" hint={state.error} />
        )}
      </PaneBody>
    </Pane>
  );
}
