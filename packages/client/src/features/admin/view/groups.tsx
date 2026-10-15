import type { ReactElement, ReactNode } from "react";
import { Button, GridAction } from "../../../ui/actions/index.ts";
import { ConfirmDialog } from "../../../ui/overlays/index.ts";
import { DataGrid } from "../../../ui/data-grid/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import {
  Inline,
  Pane,
  Stack,
  PaneHeader,
  PaneBody,
} from "../../../ui/layout/index.ts";
import { groupTypeLabel } from "../model/groups.ts";
import type { GroupsController, GroupsState } from "../model/groups.ts";

/** Groups pane: list and confirmation; the editor and member sheets arrive as `children`. */
export function GroupsView({
  state,
  actions,
  children,
}: {
  state: GroupsState;
  actions: GroupsController;
  children: ReactNode;
}): ReactElement {
  const { access, list } = state;
  return (
    <Pane className="admin-pane" data-testid="admin.groups">
      <PaneHeader
        title="群组"
        subtitle={`共 ${list.data?.total ?? 0} 条`}
        actions={
          <>
            {" "}
            <Button
              variant="primary"
              disabled={!access.edit.ok}
              onClick={actions.create}
            >
              创建群组
            </Button>{" "}
          </>
        }
      />
      <PaneBody padded className="admin-body">
        <Stack>
          {state.error && <StatePanel state="error" hint={state.error} />}
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
              rows={list.data?.items ?? []}
              rowKey={(row) => row.id}
              ariaLabel="群组列表"
              columns={[
                {
                  id: "handle",
                  label: "标识",
                  width: 170,
                  render: (row) => row.handle,
                },
                {
                  id: "name",
                  label: "名称",
                  width: 220,
                  render: (row) => row.name,
                },
                {
                  id: "type",
                  label: "类型",
                  width: 110,
                  render: groupTypeLabel,
                },
                {
                  id: "memberCount",
                  label: "成员",
                  width: 90,
                  render: (row) => row.memberCount,
                },
                {
                  id: "actions",
                  label: "操作",
                  width: 144,
                  pinned: "end",
                  hideable: false,
                  render: (row) => (
                    <Inline className="admin-grid-actions">
                      <GridAction
                        label="编辑群组"
                        disabled={!access.edit.ok}
                        onClick={() => actions.edit(row)}
                      />
                      <GridAction
                        label="查看成员"
                        disabled={!access.members.ok}
                        onClick={() => actions.openMembers(row)}
                      />
                      <GridAction
                        label="删除群组"
                        disabled={!access.edit.ok || row.type !== "normal"}
                        onClick={() => actions.askDelete(row)}
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
        </Stack>
        {children}
        <ConfirmDialog
          open={!!state.confirm}
          objectName={state.confirm?.label ?? ""}
          destructive
          onClose={actions.dismissConfirm}
          onConfirm={actions.runConfirmed}
        />
      </PaneBody>
    </Pane>
  );
}
