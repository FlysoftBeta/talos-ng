import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { DataGrid } from "../../../ui/data-grid/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import { Pane, PaneHeader, PaneBody } from "../../../ui/layout/index.ts";
import { AUDIT_PAGE_SIZE } from "../model/audit.ts";
import type { AuditController, AuditRow, AuditState } from "../model/audit.ts";

export function AuditView({
  state,
  rows,
  actions,
}: {
  state: AuditState;
  rows: readonly AuditRow[];
  actions: AuditController;
}): ReactElement {
  const { access, list } = state;
  return (
    <Pane className="admin-pane" data-testid="admin.audit">
      <PaneHeader title="审计" subtitle={`共 ${list.data?.total ?? 0} 条`} />
      <PaneBody padded className="admin-body">
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
            rowKey={(row) => row.entry.id}
            ariaLabel="审计日志"
            columns={[
              {
                id: "created",
                label: "时间",
                width: 150,
                render: (row) => row.time,
              },
              {
                id: "action",
                label: "操作",
                width: 220,
                render: (row) => row.entry.action,
              },
              {
                id: "actor",
                label: "执行者",
                width: 220,
                render: (row) => row.actor,
              },
              {
                id: "target",
                label: "对象",
                width: 230,
                render: (row) => row.target,
              },
              {
                id: "details",
                label: "详情",
                width: 76,
                render: () => "查看",
                longText: (row) => row.entry.details,
              },
            ]}
            paging={{
              page: state.page,
              pageSize: AUDIT_PAGE_SIZE,
              total: list.data?.total ?? 0,
              onPageChange: actions.setPage,
            }}
          />
        )}
      </PaneBody>
    </Pane>
  );
}
