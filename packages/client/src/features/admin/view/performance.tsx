import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { DataGrid } from "../../../ui/data-grid/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import {
  Group,
  GroupRow,
  Pane,
  PaneBody,
  PaneHeader,
  Stack,
} from "../../../ui/layout/index.ts";
import { performanceSummary } from "../model/performance.ts";
import type {
  PerformanceController,
  PerformanceState,
  SlowRow,
  StatementRow,
} from "../model/performance.ts";

/** Server performance: statement timings by total time, slow queries, event loop. */
export function PerformanceView({
  state,
  statements,
  slow,
  actions,
}: {
  state: PerformanceState;
  statements: readonly StatementRow[];
  slow: readonly SlowRow[];
  actions: PerformanceController;
}): ReactElement {
  const { access, data } = state;
  return (
    <Pane className="admin-pane" data-testid="admin.performance">
      <PaneHeader
        title="性能"
        actions={
          access.ok && (
            <>
              <Button onClick={actions.reload}>刷新</Button>
              <Button onClick={actions.reset}>重新计时</Button>
            </>
          )
        }
      />
      <PaneBody padded className="admin-body">
        {!access.ok ? (
          <StatePanel state="forbidden" hint={access.reason} />
        ) : data.loading && !data.data ? (
          <StatePanel state="loading" />
        ) : data.error ? (
          <StatePanel
            state="error"
            hint={data.error}
            action={<Button onClick={actions.reload}>重试</Button>}
          />
        ) : (
          data.data && (
            <Stack>
              <Group title="概况">
                {performanceSummary(data.data).map((line) => (
                  <GroupRow key={line.label} label={line.label}>
                    {line.value}
                  </GroupRow>
                ))}
              </Group>
              <Group title="语句耗时（按总耗时，毫秒）">
                <DataGrid
                  height={360}
                  rows={statements}
                  rowKey={(row) => row.key}
                  ariaLabel="语句耗时"
                  columns={[
                    {
                      id: "where",
                      label: "连接",
                      width: 110,
                      render: (row) => row.where,
                    },
                    {
                      id: "count",
                      label: "次数",
                      width: 80,
                      render: (row) => row.count,
                    },
                    {
                      id: "total",
                      label: "总计",
                      width: 80,
                      render: (row) => row.total,
                    },
                    {
                      id: "p50",
                      label: "p50",
                      width: 70,
                      render: (row) => row.p50,
                    },
                    {
                      id: "p95",
                      label: "p95",
                      width: 70,
                      render: (row) => row.p95,
                    },
                    {
                      id: "max",
                      label: "最大",
                      width: 70,
                      render: (row) => row.max,
                    },
                    {
                      id: "slow",
                      label: "慢",
                      width: 50,
                      render: (row) => row.slow,
                    },
                    {
                      id: "sql",
                      label: "语句",
                      width: 420,
                      render: (row) => row.sql,
                      longText: (row) => row.sql,
                    },
                  ]}
                />
              </Group>
              <Group title="最近的慢查询">
                {slow.length ? (
                  <DataGrid
                    height={240}
                    rows={slow}
                    rowKey={(row) => row.key}
                    ariaLabel="最近的慢查询"
                    columns={[
                      {
                        id: "time",
                        label: "时间",
                        width: 150,
                        render: (row) => row.time,
                      },
                      {
                        id: "where",
                        label: "连接",
                        width: 110,
                        render: (row) => row.where,
                      },
                      {
                        id: "ms",
                        label: "毫秒",
                        width: 80,
                        render: (row) => row.ms,
                      },
                      {
                        id: "sql",
                        label: "语句",
                        width: 420,
                        render: (row) => row.sql,
                        longText: (row) => row.sql,
                      },
                    ]}
                  />
                ) : (
                  <StatePanel state="empty" hint="没有超过阈值的查询" />
                )}
              </Group>
            </Stack>
          )
        )}
      </PaneBody>
    </Pane>
  );
}
