import type { ReactElement } from "react";
import { Button, IconButton } from "../../../ui/actions/index.ts";
import { ConfirmDialog, Sheet } from "../../../ui/overlays/index.ts";
import { DataGrid } from "../../../ui/data-grid/index.ts";
import { Field, SelectField, SearchField } from "../../../ui/inputs/index.ts";
import {
  CompactToolbar,
  Inline,
  KeyValue,
  Pane,
  Stack,
  PaneHeader,
  PaneBody,
} from "../../../ui/layout/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import {
  SOURCE_OPTIONS,
  relatedIds,
  selfTestObject,
  stackText,
} from "../model/incidents.ts";
import type {
  IncidentFilters,
  IncidentRow,
  IncidentsController,
  IncidentsState,
} from "../model/incidents.ts";

/** Incidents pane: filters, paged list, detail sheet, self-tests and log download. */
export function IncidentsView({
  state,
  rows,
  actions,
}: {
  state: IncidentsState;
  rows: readonly IncidentRow[];
  actions: IncidentsController;
}): ReactElement {
  const { access, selfTestAccess, filters, list, detail } = state;
  const filter = (
    name: keyof IncidentFilters,
    label: string,
    placeholder?: string,
  ) => (
    <SearchField
      label={label}
      placeholder={placeholder}
      value={filters[name]}
      onChange={(event) => actions.setFilter(name, event.target.value)}
    />
  );
  return (
    <Pane className="admin-pane" data-testid="admin.incidents">
      <PaneHeader
        title="事件"
        subtitle={`共 ${list.data?.total ?? 0} 条`}
        actions={
          <>
            {" "}
            <Inline>
              <Button onClick={() => void actions.download()}>
                下载日志 ZIP
              </Button>
              <Button
                disabled={!selfTestAccess.ok}
                onClick={() => actions.askSelfTest("server")}
              >
                服务器自检
              </Button>
              <Button
                disabled={!selfTestAccess.ok}
                onClick={() => actions.askSelfTest("client")}
              >
                客户端自检
              </Button>
            </Inline>{" "}
          </>
        }
      />
      <PaneBody padded className="admin-body">
        <Stack>
          {state.error && <StatePanel state="error" hint={state.error} />}
          <CompactToolbar className="admin-filter-toolbar">
            <SelectField
              hideLabel
              label="来源"
              value={filters.source}
              onChange={(event) =>
                actions.setFilter(
                  "source",
                  SOURCE_OPTIONS.find(
                    ([value]) => value === event.target.value,
                  )?.[0] ?? "",
                )
              }
            >
              {SOURCE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
            {filter("build", "构建 ID", "构建 ID")}
            {filter("environment", "环境", "环境（精确匹配）")}
            <Button onClick={actions.reload}>刷新事件</Button>
            {filter("level", "级别")}
            {filter("module", "模块")}
            <SearchField
              label="搜索"
              value={filters.query}
              onChange={(event) =>
                actions.setFilter("query", event.target.value)
              }
            />
            <Field
              label="开始时间"
              type="datetime-local"
              value={filters.from}
              onChange={(event) =>
                actions.setFilter("from", event.target.value)
              }
            />
            <Field
              label="结束时间"
              type="datetime-local"
              value={filters.to}
              onChange={(event) => actions.setFilter("to", event.target.value)}
            />
          </CompactToolbar>
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
              rowKey={(row) => row.id}
              ariaLabel="事件列表"
              columns={[
                {
                  id: "summary",
                  label: "摘要",
                  width: 340,
                  render: (row) => row.summary,
                  longText: (row) => row.summary,
                },
                {
                  id: "count",
                  label: "次数",
                  width: 75,
                  render: (row) => row.count,
                },
                {
                  id: "first",
                  label: "首次",
                  width: 180,
                  render: (row) => row.first,
                },
                {
                  id: "last",
                  label: "最近",
                  width: 180,
                  render: (row) => row.last,
                },
                {
                  id: "detail",
                  label: "详情",
                  width: 80,
                  pinned: "end",
                  hideable: false,
                  render: (row) => (
                    <IconButton
                      label="查看事件"
                      icon="info"
                      onClick={() => actions.openDetail(row.id)}
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
          <Sheet
            open={!!state.detailId}
            title="事件详情"
            onClose={actions.closeDetail}
          >
            {detail.loading ? (
              <StatePanel state="loading" />
            ) : detail.error ? (
              <StatePanel state="error" hint={detail.error} />
            ) : (
              detail.data && (
                <Stack>
                  <KeyValue label="事件 ID">{detail.data.id}</KeyValue>
                  <KeyValue label="摘要">{detail.data.summary}</KeyValue>
                  <KeyValue label="来源">{detail.data.source}</KeyValue>
                  <KeyValue label="构建">{detail.data.build}</KeyValue>
                  <KeyValue label="环境">{detail.data.environment}</KeyValue>
                  <KeyValue label="级别">{detail.data.level}</KeyValue>
                  <KeyValue label="模块">{detail.data.module}</KeyValue>
                  <KeyValue label="次数">{detail.data.count}</KeyValue>
                  <KeyValue label="相关 ID">{relatedIds(detail.data)}</KeyValue>
                  <h3>堆栈</h3>
                  <pre className="admin-incident-stack">
                    {stackText(detail.data)}
                  </pre>
                </Stack>
              )
            )}
          </Sheet>
          <ConfirmDialog
            open={!!state.confirm}
            objectName={
              state.confirm
                ? selfTestObject(state.confirm)
                : "服务器诊断自检事件"
            }
            onClose={actions.dismissConfirm}
            onConfirm={actions.runSelfTest}
          />
        </Stack>
      </PaneBody>
    </Pane>
  );
}
