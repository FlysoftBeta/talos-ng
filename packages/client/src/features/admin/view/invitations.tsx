import type { ReactElement } from "react";
import { Button, GridAction } from "../../../ui/actions/index.ts";
import { ConfirmDialog } from "../../../ui/overlays/index.ts";
import { DataGrid, SelectionActionBar } from "../../../ui/data-grid/index.ts";
import { OfflineHint, StatePanel } from "../../../ui/feedback/index.ts";
import {
  KeyValue,
  Pane,
  Stack,
  PaneHeader,
  PaneBody,
} from "../../../ui/layout/index.ts";
import { invitationExpiry } from "../model/invitations.ts";
import type {
  InvitationRow,
  InvitationsController,
  InvitationsState,
} from "../model/invitations.ts";

/** Invitations pane: creation result, paged grid and revocation confirmations. */
export function InvitationsView({
  state,
  rows,
  actions,
}: {
  state: InvitationsState;
  rows: readonly InvitationRow[];
  actions: InvitationsController;
}): ReactElement {
  const { access, createAccess, created, list, selected } = state;
  return (
    <Pane className="admin-pane" data-testid="admin.invitations">
      <PaneHeader
        title="邀请"
        subtitle={`共 ${list.data?.total ?? 0} 条`}
        actions={
          <>
            {" "}
            <OfflineHint
              label="创建邀请"
              reason={createAccess.ok ? undefined : createAccess.reason}
            >
              <Button
                variant="contained"
                disabled={!createAccess.ok}
                onClick={() => void actions.create()}
              >
                创建邀请
              </Button>
            </OfflineHint>{" "}
          </>
        }
      />
      <PaneBody padded className="admin-body">
        <Stack>
          {created && (
            <div
              className="admin-pin-result"
              data-testid="admin.invitations.result"
            >
              <p>一次性邀请码</p>
              <span
                className="admin-pin selectable"
                data-testid="admin.invitations.pin"
              >
                {created.pin}
              </span>
              <KeyValue label="有效期至">{invitationExpiry(created)}</KeyValue>
              <p>请当面提供给受邀成员；邀请码使用一次后失效。</p>
            </div>
          )}
          {state.error && <StatePanel state="error" hint={state.error} />}
          {!!selected.size && (
            <SelectionActionBar
              count={selected.size}
              onClear={actions.clearSelection}
            >
              <Button color="error" onClick={actions.askBulkRevoke}>
                批量撤销
              </Button>
            </SelectionActionBar>
          )}
          {!access.ok ? (
            <StatePanel state="forbidden" hint={access.reason} />
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
              rowKey={(row) => row.invitation.id}
              ariaLabel="邀请列表"
              selection={{
                selectedKeys: selected,
                onChange: actions.setSelected,
              }}
              columns={[
                {
                  id: "id",
                  label: "邀请 ID",
                  width: 260,
                  render: (row) => row.invitation.id,
                },
                {
                  id: "created",
                  label: "创建时间",
                  width: 190,
                  render: (row) => row.created,
                },
                {
                  id: "expires",
                  label: "过期时间",
                  width: 190,
                  render: (row) => row.expires,
                },
                {
                  id: "status",
                  label: "状态",
                  width: 130,
                  render: (row) => row.status,
                },
                {
                  id: "actions",
                  label: "操作",
                  width: 80,
                  pinned: "end",
                  hideable: false,
                  render: (row) => (
                    <GridAction
                      label="撤销邀请"
                      disabled={!row.canRevoke}
                      onClick={() => actions.askRevoke(row.invitation)}
                    />
                  ),
                },
              ]}
              paging={{
                page: state.page,
                pageSize: 50,
                total: list.data?.total ?? 0,
                onPageChange: actions.setPage,
              }}
            />
          )}

          <ConfirmDialog
            open={state.bulkConfirm}
            objectName={`${selected.size} 个待使用邀请`}
            destructive
            onClose={actions.dismissBulkRevoke}
            onConfirm={actions.runBulkRevoke}
          />
          <ConfirmDialog
            open={!!state.revoke}
            objectName={`邀请 ${state.revoke?.id ?? ""}`}
            destructive
            onClose={actions.dismissRevoke}
            onConfirm={actions.runRevoke}
          />
        </Stack>
      </PaneBody>
    </Pane>
  );
}
