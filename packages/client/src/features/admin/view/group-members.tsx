import type { ReactElement } from "react";
import { Button, GridAction } from "../../../ui/actions/index.ts";
import { Sheet } from "../../../ui/overlays/index.ts";
import { DataGrid, SelectionActionBar } from "../../../ui/data-grid/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import { Field } from "../../../ui/inputs/index.ts";
import { Group, Inline, Stack, Tag } from "../../../ui/layout/index.ts";
import type {
  GroupsController,
  GroupsState,
  MemberRow,
} from "../model/groups.ts";

/** Member sheet of one group: exact-name add, removal, ownership transfer and bulk removal. */
export function GroupMembersSheet({
  state,
  rows,
  canAdd,
  actions,
}: {
  state: GroupsState;
  rows: readonly MemberRow[];
  /** An exact user-name match is available to add. */
  canAdd: boolean;
  actions: GroupsController;
}): ReactElement {
  const { memberGroup: group, members, selectedMembers } = state;
  return (
    <Sheet
      open={!!group}
      title={`群组成员 · ${group?.name ?? ""}`}
      onClose={actions.closeMembers}
      footer={
        <>
          <Button onClick={actions.closeMembers}>取消</Button>
          <Button
            variant="primary"
            disabledReason={canAdd ? undefined : "输入有效的完整用户名"}
            onClick={actions.addExact}
          >
            添加成员
          </Button>
        </>
      }
    >
      <Stack>
        {state.error && <StatePanel state="error" hint={state.error} />}
        {members.loading ? (
          <StatePanel state="loading" />
        ) : members.error ? (
          <StatePanel state="error" hint={members.error} />
        ) : (
          <>
            <Group title="添加成员" className="admin-form">
              <Field
                label="按用户名精确添加"
                value={state.handle}
                onChange={(event) => actions.setHandle(event.target.value)}
              />
            </Group>

            {selectedMembers.size > 0 && (
              <SelectionActionBar
                count={selectedMembers.size}
                onClear={actions.clearSelectedMembers}
              >
                <Button onClick={actions.askRemoveSelected}>
                  移除选中成员
                </Button>
              </SelectionActionBar>
            )}
            {rows.length ? (
              <DataGrid
                height={Math.min(352, Math.max(44, rows.length * 44))}
                rows={rows}
                rowKey={(row) => row.member.user}
                ariaLabel="群组成员"
                selection={{
                  selectedKeys: selectedMembers,
                  onChange: actions.setSelectedMembers,
                  isRowSelectable: (row) => row.canRemove,
                }}
                columns={[
                  {
                    id: "handle",
                    label: "用户名",
                    width: 150,
                    render: (row) => row.member.handle,
                  },
                  {
                    id: "name",
                    label: "姓名",
                    width: 160,
                    render: (row) => row.member.name,
                  },
                  {
                    id: "role",
                    label: "群组角色",
                    width: 100,
                    render: (row) => row.role,
                  },
                  {
                    id: "hidden",
                    label: "隐藏状态",
                    width: 100,
                    render: (row) => <Tag>{row.visibility}</Tag>,
                  },
                  {
                    id: "actions",
                    label: "操作",
                    width: 104,
                    pinned: "end",
                    hideable: false,
                    render: (row) => (
                      <Inline className="admin-grid-actions">
                        <GridAction
                          label="移除成员"
                          disabled={!row.canRemove}
                          onClick={() =>
                            group && actions.askRemove(group, row.member)
                          }
                        />
                        <GridAction
                          label="设为群主"
                          disabled={!row.canMakeOwner}
                          onClick={() =>
                            group && actions.askOwner(group, row.member)
                          }
                        />
                      </Inline>
                    ),
                  },
                ]}
              />
            ) : (
              <StatePanel state="empty" title="暂无成员" />
            )}
          </>
        )}
      </Stack>
    </Sheet>
  );
}
