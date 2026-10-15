import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import type { Netbook } from "@talos/contract";
import { Button, IconButton } from "../../../ui/actions/index.ts";
import { Dialog } from "../../../ui/overlays/index.ts";
import { SearchField, SelectField } from "../../../ui/inputs/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import {
  InlineNotice,
  OfflineHint,
  StatePanel,
} from "../../../ui/feedback/index.ts";
import "./netbooks.css";

export interface NetbooksDialogViewProps {
  query: string;
  onQuery: (query: string) => void;
  /** Search may be submitted (Enter key and button). */
  canSearch: boolean;
  onSearch: () => void;
  busy: boolean;
  seconds: number;
  reason: string | undefined;
  /** The reason is a missing entitlement rather than missing connectivity. */
  forbidden: boolean;
  destinations: { id: string; title: string }[];
  collection: string;
  onCollection: (id: string) => void;
  error: string;
  books: Netbook[] | null;
  /** Whether a book's download request is being submitted. */
  downloading: string | undefined;
  /** Status text of an already submitted book, by book id. */
  submittedLabel: (book: string) => string | undefined;
  onDownload: (book: string) => void;
  notice: string;
  onShowTasks: () => void;
  onClose: () => void;
}
function BookRow({
  book,
  props,
}: {
  book: Netbook;
  props: NetbooksDialogViewProps;
}): ReactElement {
  const label = props.submittedLabel(book.id);
  return (
    <div className="netbooks-book" data-testid="ui.row">
      <span className="netbooks-cover" aria-hidden="true">
        <Icon name="book" size={18} />
      </span>
      <div className="netbooks-copy">
        <span className="netbooks-title ellipsis" data-testid="ui.row.title">
          {book.title}
        </span>
        <span className="netbooks-author ellipsis">{book.author}</span>
        {book.abstract && <p className="netbooks-abstract">{book.abstract}</p>}
      </div>
      <div className="netbooks-action">
        {label !== undefined ? (
          <span className="netbooks-state is-done" role="status">
            <Icon name="check" size={16} />
            {label}
          </span>
        ) : props.downloading === book.id ? (
          <span className="netbooks-state" role="status">
            <Icon name="loading" size={16} spin />
            提交中
          </span>
        ) : (
          <Button
            variant="secondary"
            size="small"
            icon="download"
            aria-label={`下载 ${book.title}`}
            disabled={props.busy}
            disabledReason={
              props.reason ||
              (props.collection ? undefined : "请先选择下载到的书单")
            }
            onClick={() => props.onDownload(book.id)}
          >
            下载
          </Button>
        )}
      </div>
    </div>
  );
}
export function NetbooksDialogView(
  props: NetbooksDialogViewProps,
): ReactElement {
  const { reason, seconds, busy } = props;
  return (
    <Dialog
      open
      size="lg"
      title="网络书籍"
      subtitle="搜索番茄小说，下载后保存为书单中的文本文档"
      onClose={props.onClose}
      footer={
        <Button variant="secondary" icon="list" onClick={props.onShowTasks}>
          查看任务
        </Button>
      }
    >
      <div className="netbooks">
        <div className="netbooks-query">
          <SearchField
            label="书名或作者"
            placeholder="搜索书名或作者"
            value={props.query}
            maxLength={100}
            onChange={(e) => props.onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && props.canSearch) props.onSearch();
            }}
          />
          {seconds > 0 && (
            <span className="netbooks-timer" role="timer" aria-live="polite">
              {seconds} 秒
            </span>
          )}
          <OfflineHint label="搜索" reason={reason}>
            <Button
              variant="primary"
              aria-label="搜索"
              busy={busy && !props.downloading}
              disabled={busy || !props.query.trim() || seconds > 0}
              onClick={props.onSearch}
            >
              搜索
            </Button>
          </OfflineHint>
        </div>
        <div className="netbooks-destination">
          <SelectField
            label="下载到书单"
            value={props.collection}
            disabled={!props.destinations.length}
            onChange={(e) => props.onCollection(e.target.value)}
          >
            <option value="">选择书单</option>
            {props.destinations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </SelectField>
          {!props.destinations.length && (
            <small className="field-hint">
              还没有可编辑的书单，请先在阅读中新建书单
            </small>
          )}
        </div>
        {props.notice && (
          <InlineNotice tone="confirmed">{props.notice}</InlineNotice>
        )}
        <div className="netbooks-results">
          {reason ? (
            <StatePanel
              compact
              state={props.forbidden ? "forbidden" : "offline"}
              title={props.forbidden ? undefined : "离线时无法搜索"}
              hint={reason}
            />
          ) : busy && !props.downloading ? (
            <StatePanel compact state="loading" title="正在搜索" />
          ) : props.error ? (
            <StatePanel
              compact
              state="error"
              hint={props.error}
              action={
                seconds === 0 ? (
                  <Button variant="secondary" onClick={props.onSearch}>
                    重试
                  </Button>
                ) : undefined
              }
            />
          ) : props.books === null ? (
            <StatePanel
              compact
              state="empty"
              title="搜索网络书籍"
              hint="输入书名或作者，最多显示 20 个结果"
            />
          ) : props.books.length === 0 ? (
            <StatePanel
              compact
              state="empty"
              title="没有找到书籍"
              hint="换个书名或作者试试"
            />
          ) : (
            props.books.map((b) => (
              <BookRow key={b.id} book={b} props={props} />
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
export function NetbooksEntryView({
  open,
  onOpen,
  children,
}: {
  open: boolean;
  onOpen: () => void;
  children: ReactElement;
}): ReactElement {
  // The dialog mounts at the app root, not inside the list pane it is opened from.
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => setRoot(document.querySelector<HTMLElement>(".talos")), []);
  return (
    <span className="netbooks-entry">
      <IconButton label="网络书籍" icon="globe" onClick={onOpen} />
      {open && root && createPortal(children, root)}
    </span>
  );
}
