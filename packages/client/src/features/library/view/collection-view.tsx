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
  title: string;
  items: CollectionItem[];
  canWrite: boolean;
  canDelete: boolean;
  busy: boolean;
  error: string;
  unavailableReason?: string;
  onBack: () => void;
  onOpenDocument: (id: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  /** Add-document dialog state. */
  adding: boolean;
  onAdd: () => void;
  onCloseAdd: () => void;
  candidates: { id: string; title: string }[];
  selected: string;
  onSelect: (id: string) => void;
  onConfirmAdd: () => void;
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
            <IconButton
              label="分享"
              icon="share"
              disabledReason={reason}
              onClick={props.onShare}
            />
            {props.canWrite && (
              <IconButton
                label="添加文档"
                icon="plus"
                disabled={props.busy}
                disabledReason={reason}
                onClick={props.onAdd}
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
                  props.canWrite ? (
                    <Menu
                      label={`更多操作 ${name}`}
                      size="small"
                      items={[
                        {
                          label: "上移",
                          icon: "arrow-up",
                          hidden: index === 0,
                          disabledReason: rowReason,
                          onSelect: () => props.onMove(index, -1),
                        },
                        {
                          label: "下移",
                          icon: "arrow-down",
                          hidden: index === last,
                          disabledReason: rowReason,
                          onSelect: () => props.onMove(index, 1),
                        },
                        {
                          label: "移出书单",
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
            hint={
              props.canWrite
                ? "添加文档后可调整阅读顺序"
                : "拥有编辑权限的人可以添加文档"
            }
          />
        )}
      </PaneBody>
      {props.shareSheet}
      {props.adding && (
        <Dialog
          open
          size="sm"
          title="添加文档"
          subtitle={props.title}
          onClose={props.onCloseAdd}
          footer={
            <>
              <Button variant="secondary" onClick={props.onCloseAdd}>
                取消
              </Button>
              <Button
                variant="primary"
                busy={props.busy}
                disabled={!props.selected}
                onClick={props.onConfirmAdd}
              >
                添加到书单
              </Button>
            </>
          }
        >
          {props.candidates.length ? (
            <SelectField
              label="文档"
              value={props.selected}
              onChange={(e) => props.onSelect(e.target.value)}
            >
              <option value="">选择文档</option>
              {props.candidates.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title}
                </option>
              ))}
            </SelectField>
          ) : (
            <StatePanel compact state="empty" hint="没有可添加的文档" />
          )}
        </Dialog>
      )}
      {props.deleting && (
        <ConfirmDialog
          open
          destructive
          objectName={props.title}
          message="书单将被删除，其中的文档仍保留在书架中。"
          onClose={props.onCloseDelete}
          onConfirm={props.onConfirmDelete}
        />
      )}
    </Pane>
  );
}
