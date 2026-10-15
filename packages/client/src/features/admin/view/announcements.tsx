import type { ReactElement } from "react";
import { Button, GridAction } from "../../../ui/actions/index.ts";
import { ConfirmDialog, Sheet } from "../../../ui/overlays/index.ts";
import { DataGrid } from "../../../ui/data-grid/index.ts";
import { Field, TextArea } from "../../../ui/inputs/index.ts";
import { Pane, Stack, PaneHeader, PaneBody } from "../../../ui/layout/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import {
  TEXT_LIMIT,
  TITLE_LIMIT,
  acknowledgement,
  publishedAt,
  sheetTitle,
} from "../model/announcements.ts";
import type {
  AnnouncementsController,
  AnnouncementsState,
} from "../model/announcements.ts";

/** Announcement pane: revision history, draft / preview sheet and publication confirmation. */
export function AnnouncementsView({
  state,
  canPublish,
  actions,
}: {
  state: AnnouncementsState;
  canPublish: boolean;
  actions: AnnouncementsController;
}): ReactElement {
  const { history, draft, preview, viewingHistory } = state;
  return (
    <Pane className="admin-pane" data-testid="admin.announcements">
      <PaneHeader
        title="公告"
        subtitle={`共 ${history.data?.total ?? 0} 条`}
        actions={
          <>
            {" "}
            <Button
              variant="primary"
              disabled={!state.publish.ok}
              onClick={actions.newDraft}
            >
              发布新版本
            </Button>{" "}
          </>
        }
      />
      <PaneBody padded className="admin-body">
        <Stack>
          {state.error && <StatePanel state="error" hint={state.error} />}
          {!state.list.ok ? (
            <StatePanel state="forbidden" hint={state.list.reason} />
          ) : history.loading ? (
            <StatePanel state="loading" />
          ) : history.error ? (
            <StatePanel
              state="error"
              hint={history.error}
              action={<Button onClick={actions.reload}>重试</Button>}
            />
          ) : (
            <DataGrid
              height="fill"
              rows={history.data?.items ?? []}
              rowKey={(row) => String(row.revision)}
              ariaLabel="公告历史"
              columns={[
                {
                  id: "revision",
                  label: "版本",
                  width: 100,
                  render: (row) => row.revision,
                },
                {
                  id: "title",
                  label: "标题",
                  width: 260,
                  render: (row) => row.title,
                },
                {
                  id: "published",
                  label: "发布时间",
                  width: 220,
                  render: publishedAt,
                },
                {
                  id: "ack",
                  label: "已确认 / 应确认",
                  width: 160,
                  render: acknowledgement,
                },
                {
                  id: "view",
                  label: "内容",
                  width: 80,
                  pinned: "end",
                  hideable: false,
                  render: (row) => (
                    <GridAction
                      label="查看公告"
                      onClick={() => actions.viewRevision(row)}
                    />
                  ),
                },
              ]}
              paging={{
                page: state.page,
                pageSize: 50,
                total: history.data?.total ?? 0,
                onPageChange: actions.setPage,
              }}
            />
          )}
        </Stack>
        <Sheet
          open={!!draft}
          title={sheetTitle(viewingHistory, preview)}
          onClose={actions.closeSheet}
          footer={
            <>
              {!viewingHistory && (
                <>
                  <Button onClick={actions.togglePreview}>
                    {preview ? "返回编辑" : "预览"}
                  </Button>
                  <Button
                    disabled={!canPublish}
                    variant="contained"
                    onClick={actions.askPublish}
                  >
                    发布新版本
                  </Button>
                </>
              )}
            </>
          }
        >
          <Stack>
            {draft && (
              <>
                {preview ? (
                  <>
                    <h2>{draft.title}</h2>
                    <div className="selectable admin-announcement-text">
                      {draft.text}
                    </div>
                  </>
                ) : (
                  <>
                    <Field
                      label="标题"
                      value={draft.title}
                      maxLength={TITLE_LIMIT}
                      onChange={(event) => actions.setTitle(event.target.value)}
                    />
                    <TextArea
                      label="正文"
                      value={draft.text}
                      maxLength={TEXT_LIMIT}
                      rows={12}
                      onChange={(event) => actions.setText(event.target.value)}
                    />
                  </>
                )}
              </>
            )}
          </Stack>
        </Sheet>
        <ConfirmDialog
          open={state.confirm}
          objectName="新公告版本（所有成员须重新确认）"
          onClose={actions.dismissConfirm}
          onConfirm={actions.runConfirmed}
        />
      </PaneBody>
    </Pane>
  );
}
