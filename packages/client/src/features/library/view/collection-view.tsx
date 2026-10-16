import type { ReactElement, ReactNode } from "react";
import { Button, IconButton } from "../../../ui/actions/index.ts";
import { ConfirmDialog, Dialog, Menu } from "../../../ui/overlays/index.ts";
import { SelectField } from "../../../ui/inputs/index.ts";
import { Pane, PaneBody, PaneHeader, Tag } from "../../../ui/layout/index.ts";
import {
  InlineNotice,
  ListRow,
  StatePanel,
} from "../../../ui/feedback/index.ts";
import { LibraryTile } from "./library-list.tsx";
import type { RowTag } from "./library-list.tsx";
import "./library.css";

export interface CollectionItem {
  id: string;
  /** Resolved document title, absent while the document is not readable. */
  title: string | undefined;
  /** Size, date and progress of the document. */
  hint?: string;
  tag?: RowTag;
}
export interface CollectionViewProps {
  retentionControl: ReactNode;
  title: string;
  items: CollectionItem[];
  canWrite: boolean;
  canDelete: boolean;
  canShare: boolean;
  canTransfer: boolean;
  busy: boolean;
  error: string;
  unavailableReason?: string;
  onBack: () => void;
  onOpenDocument: (id: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  transferring: string;
  onTransfer: (doc: string) => void;
  onCloseTransfer: () => void;
  destinations: { id: string; title: string }[];
  selected: string;
  onSelect: (id: string) => void;
  onConfirmTransfer: () => void;
  /** Share sheet; supplied by the connection because it needs the sharing adapter. */
  shareSheet: ReactNode;
  onShare: () => void;
  deleting: boolean;
  onDelete: () => void;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
}
export function CollectionView(props: CollectionViewProps): ReactElement {
  const reason = props.unavailableReason,
    rowReason = reason || (props.busy ? "正在保存书单" : undefined),
    last = props.items.length - 1;
  return (
    <Pane className="lib-collection">
      <PaneHeader
        title={props.title}
        subtitle={`${props.items.length} 份文档`}
        actions={
          <>
            {props.retentionControl}
            {props.canShare && (
              <IconButton
                label="分享"
                icon="share"
                disabledReason={reason}
                onClick={props.onShare}
              />
            )}
            {props.canDelete && (
              <Menu
                label="更多操作"
                items={[
                  {
                    label: "删除书单",
                    icon: "trash",
                    danger: true,
                    disabledReason: reason,
                    onSelect: props.onDelete,
                  },
                ]}
              />
            )}
          </>
        }
      />
      <PaneBody className="lib-collection-body">
        {props.error && (
          <div className="lib-notice">
            <InlineNotice tone="failed">{props.error}</InlineNotice>
          </div>
        )}
        {props.items.length ? (
          props.items.map((item, index) => {
            const name = item.title ?? "文档暂不可用";
            return (
              <ListRow
                key={item.id}
                title={name}
                hint={item.title === undefined ? "无权访问或已删除" : item.hint}
                leading={<LibraryTile icon="document" />}
                badge={
                  item.tag ? (
                    <Tag tone={item.tag.tone}>{item.tag.label}</Tag>
                  ) : undefined
                }
                onClick={
                  item.title !== undefined
                    ? () => props.onOpenDocument(item.id)
                    : undefined
                }
                trailing={
                  props.canWrite || props.canTransfer ? (
                    <Menu
                      label={`更多操作 ${name}`}
                      size="small"
                      items={[
                        {
                          label: "转存到书单",
                          icon: "book",
                          hidden: !props.canTransfer,
                          disabledReason: rowReason,
                          onSelect: () => props.onTransfer(item.id),
                        },
                        {
                          label: "上移",
                          icon: "arrow-up",
                          hidden: !props.canWrite || index === 0,
                          disabledReason: rowReason,
                          onSelect: () => props.onMove(index, -1),
                        },
                        {
                          label: "下移",
                          icon: "arrow-down",
                          hidden: !props.canWrite || index === last,
                          disabledReason: rowReason,
                          onSelect: () => props.onMove(index, 1),
                        },
                        {
                          label: "移出书单",
                          hidden: !props.canWrite,
                          icon: "minus",
                          danger: true,
                          disabledReason: rowReason,
                          onSelect: () => props.onRemove(item.id),
                        },
                      ]}
                    />
                  ) : undefined
                }
              />
            );
          })
        ) : (
          <StatePanel
            state="empty"
            title="书单还是空的"
            hint="请从导入入口或允许转存的来源书单添加文档"
          />
        )}
      </PaneBody>
      {props.shareSheet}
      {props.transferring && (
        <Dialog
          open
          size="sm"
          title="转存到书单"
          subtitle={props.title}
          onClose={props.onCloseTransfer}
          footer={
            <>
              <Button variant="secondary" onClick={props.onCloseTransfer}>
                取消
              </Button>
              <Button
                variant="primary"
                busy={props.busy}
                disabled={!props.selected}
                onClick={props.onConfirmTransfer}
              >
                确认转存
              </Button>
            </>
          }
        >
          {props.destinations.length ? (
            <SelectField
              label="目标书单"
              value={props.selected}
              onChange={(e) => props.onSelect(e.target.value)}
            >
              <option value="">选择书单</option>
              {props.destinations.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title}
                </option>
              ))}
            </SelectField>
          ) : (
            <StatePanel compact state="empty" hint="没有可写入的目标书单" />
          )}
        </Dialog>
      )}
      {props.deleting && (
        <ConfirmDialog
          open
          destructive
          objectName={props.title}
          message="书单将被删除。没有其他书单收录的文档也将被永久删除。"
          onClose={props.onCloseDelete}
          onConfirm={props.onConfirmDelete}
        />
      )}
    </Pane>
  );
}
