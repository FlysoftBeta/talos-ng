import type { ReactElement, ReactNode } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { Dialog, Menu } from "../../../ui/overlays/index.ts";
import { Field, SelectField } from "../../../ui/inputs/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import type { IconName } from "../../../ui/icon/icon.tsx";
import {
  Pane,
  PaneBody,
  PaneHeader,
  PaneTools,
  Tag,
} from "../../../ui/layout/index.ts";
import {
  ListRow,
  RecentSection,
  StatePanel,
} from "../../../ui/feedback/index.ts";
import type { RecentItemView } from "../../../ui/feedback/index.ts";
import { Segmented } from "../../../ui/navigation/index.ts";
import type { LibraryTab, ListRowModel } from "../model/library-data.ts";
import "./library.css";

/** Inline retention or download state of a document row. */
export interface RowTag {
  label: string;
  tone?: "accent" | "pending" | "failed" | "confirmed";
}
export type LibraryRow = ListRowModel & { tag?: RowTag };

/** The 36 px leading tile of library rows. */
export function LibraryTile({ icon }: { icon: IconName }): ReactElement {
  return (
    <span className="lib-tile" aria-hidden="true">
      <Icon name={icon} size={18} />
    </span>
  );
}

export interface LibraryListViewProps {
  /** Slot beside the add menu (the application places network books here). */
  toolbarExtra?: ReactNode;
  /** Why importing or creating is unavailable, if it is. */
  unavailableReason?: string;
  onImport: () => void;
  tab: LibraryTab;
  onTab: (tab: string) => void;
  groups: { id: string; title: string }[];
  group: string;
  onGroup: (group: string) => void;
  onCreate: () => void;
  collections: ListRowModel[];
  builtins: ListRowModel[];
  documents: LibraryRow[];
  /** Recently opened books and booklists (recent tab). */
  recent: readonly RecentItemView[];
  /** Books and booklists opened often, not already under recent. */
  frequent: readonly RecentItemView[];
  emptyShelf: { state: "offline" | "empty" | "loading"; title: string };
  onOpenCollection: (id: string) => void;
  onOpenDocument: (id: string) => void;
  /** Dialogs rendered inside the list container. */
  children?: ReactNode;
}
export function LibraryListView(props: LibraryListViewProps): ReactElement {
  const reason = props.unavailableReason;
  return (
    <Pane className="lib-list">
      <PaneHeader
        title="阅读"
        actions={
          <>
            {props.toolbarExtra}
            <Menu
              label="添加"
              icon="plus"
              items={[
                {
                  label: "导入文档",
                  icon: "upload",
                  disabledReason: reason,
                  onSelect: props.onImport,
                },
                {
                  label: "新建书单",
                  icon: "book",
                  disabledReason: reason,
                  onSelect: props.onCreate,
                },
              ]}
            />
          </>
        }
      />
      <PaneTools>
        <Segmented
          label="阅读分类"
          block
          value={props.tab}
          options={[
            { value: "recent", label: "最近" },
            { value: "collections", label: "书单" },
          ]}
          onChange={props.onTab}
        />
      </PaneTools>
      <PaneBody className="lib-list-body">
        {props.tab === "recent" &&
          props.builtins.map((c) => (
            <ListRow
              key={c.id}
              title={c.title}
              hint={c.hint}
              selected={c.selected}
              leading={<LibraryTile icon="book" />}
              onClick={() => props.onOpenCollection(c.id)}
            />
          ))}
        {props.tab === "recent" && (
          <>
            <RecentSection title="最近阅读" items={props.recent} />
            <RecentSection title="常读" items={props.frequent} />
          </>
        )}
        {props.tab === "collections" ? (
          <>
            {props.groups.length > 0 && (
              <div className="lib-filter">
                <SelectField
                  label="群组书单"
                  hideLabel
                  value={props.group}
                  onChange={(e) => props.onGroup(e.target.value)}
                >
                  <option value="">全部群组</option>
                  {props.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </SelectField>
              </div>
            )}
            {props.collections.length ? (
              props.collections.map((c) => (
                <ListRow
                  key={c.id}
                  title={c.title}
                  hint={c.hint}
                  selected={c.selected}
                  leading={<LibraryTile icon="book" />}
                  onClick={() => props.onOpenCollection(c.id)}
                />
              ))
            ) : (
              <StatePanel
                compact
                state={props.emptyShelf.state}
                title={
                  props.emptyShelf.state === "loading"
                    ? "正在同步书单"
                    : "还没有书单"
                }
                hint={
                  props.emptyShelf.state === "empty"
                    ? "新建书单，把文档整理在一起"
                    : undefined
                }
              />
            )}
          </>
        ) : props.documents.length ? (
          props.documents.map((doc) => (
            <ListRow
              key={doc.id}
              title={doc.title}
              selected={doc.selected}
              hint={doc.hint}
              leading={<LibraryTile icon="document" />}
              badge={
                doc.tag ? (
                  <Tag tone={doc.tag.tone}>{doc.tag.label}</Tag>
                ) : undefined
              }
              onClick={() => props.onOpenDocument(doc.id)}
            />
          ))
        ) : (
          <StatePanel
            compact
            state={props.emptyShelf.state}
            title={props.emptyShelf.title}
            hint={
              props.emptyShelf.state === "empty"
                ? "导入文本或 PDF，即可开始阅读"
                : undefined
            }
          />
        )}
      </PaneBody>
      {props.children}
    </Pane>
  );
}
export interface CreateCollectionDialogProps {
  title: string;
  onTitle: (title: string) => void;
  error: string;
  canCreate: boolean;
  onCreate: () => void;
  onClose: () => void;
}
export function CreateCollectionDialog(
  props: CreateCollectionDialogProps,
): ReactElement {
  return (
    <Dialog
      open
      size="sm"
      title="新建书单"
      onClose={props.onClose}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={!props.canCreate}
            onClick={props.onCreate}
          >
            创建书单
          </Button>
        </>
      }
    >
      <Field
        label="书单名称"
        value={props.title}
        maxLength={200}
        error={props.error || undefined}
        onChange={(e) => props.onTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && props.canCreate) props.onCreate();
        }}
      />
    </Dialog>
  );
}
