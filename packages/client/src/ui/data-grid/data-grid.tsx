import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Dialog } from "../overlays/overlays.tsx";
import { StatePanel } from "../feedback/feedback.tsx";
import { VirtualList } from "../virtual/VirtualList.tsx";
import { Button } from "../actions/button.tsx";
import { Icon } from "../icon/icon.tsx";
import { Checkbox, SearchField } from "../inputs/field.tsx";
import "./data-grid.css";

export interface DataGridColumn<Row> {
  id: string;
  label: string;
  width: number;
  render: (row: Row) => ReactNode;
  sortable?: boolean;
  hideable?: boolean;
  hiddenByDefault?: boolean;
  pinned?: "start" | "end";
  longText?: (row: Row) => string | null | undefined;
}
export interface DataGridSelection<Row> {
  selectedKeys: ReadonlySet<string>;
  onChange: (keys: Set<string>) => void;
  isRowSelectable?: (row: Row) => boolean;
}
export interface DataGridPaging {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}
export interface DataGridSort {
  columnId: string;
  direction: "asc" | "desc";
  onChange: (columnId: string, direction: "asc" | "desc") => void;
}
export interface DataGridSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}
export interface DataGridProps<Row> {
  rows: readonly Row[];
  columns: readonly DataGridColumn<Row>[];
  rowKey: (row: Row) => string;
  height?: number | "fill";
  selection?: DataGridSelection<Row>;
  paging?: DataGridPaging;
  sort?: DataGridSort;
  search?: DataGridSearch;
  onRowClick?: (row: Row) => void;
  empty?: string;
  ariaLabel?: string;
  /** Stable e2e hook for the grid root (see docs/impl/e2e-hooks.md). */
  testId?: string;
}

/** Controlled, page-scoped admin grid. Callers fetch and sort each page on the server. */
export function DataGrid<Row>({
  rows,
  columns,
  rowKey,
  height = 432,
  selection,
  paging,
  sort,
  search,
  onRowClick,
  empty = "暂无数据",
  ariaLabel = "数据表",
  testId,
}: DataGridProps<Row>): ReactElement {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        columns
          .filter((column) => column.hiddenByDefault)
          .map((column) => column.id),
      ),
  );
  const [showColumns, setShowColumns] = useState(false);
  const headerScroll = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState(0);
  // Measure after layout and on resize; the window fallback works on Chrome 70.
  useLayoutEffect(() => {
    if (height !== "fill" || !root.current) return;
    const node = root.current;
    const measure = () => {
      const chrome = Array.from(node.children).reduce(
        (sum, child) =>
          child.classList.contains("data-grid-tools") ||
          child.classList.contains("data-grid-header-scroll") ||
          child.classList.contains("data-grid-pager")
            ? sum + (child as HTMLElement).offsetHeight
            : sum,
        0,
      );
      setBodyHeight(Math.max(44, node.clientHeight - chrome));
    };
    measure();
    window.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  });
  const [expanded, setExpanded] = useState<{
    title: string;
    text: string;
  } | null>(null);
  const visible = useMemo(
    () => columns.filter((column) => !hidden.has(column.id)),
    [columns, hidden],
  );
  const selectable = selection
    ? rows.filter((row) => selection.isRowSelectable?.(row) !== false)
    : [];
  const allSelected =
    selectable.length > 0 &&
    selectable.every((row) => selection?.selectedKeys.has(rowKey(row)));
  const someSelected = selectable.some((row) =>
    selection?.selectedKeys.has(rowKey(row)),
  );
  const first = visible[0];
  const last = visible[visible.length - 1];
  const selectionWidth = selection ? 40 : 0;
  const width =
    selectionWidth + visible.reduce((total, column) => total + column.width, 0);
  const template = `${selection ? "40px " : ""}${visible.map((column, index) => (index === visible.length - 1 ? `minmax(${column.width}px, 1fr)` : `${column.width}px`)).join(" ")}`;
  const pinned = (column: DataGridColumn<Row>): string => {
    if (column.pinned === "start" || (!column.pinned && column === first))
      return " grid-cell-pinned-start";
    if (
      column.pinned === "end" ||
      (!column.pinned && column === last && visible.length > 1)
    )
      return " grid-cell-pinned-end";
    return "";
  };
  const pageCount = paging
    ? Math.max(1, Math.ceil(paging.total / paging.pageSize))
    : 1;
  return (
    <div
      ref={root}
      className={`data-grid${height === "fill" ? " data-grid-fill" : ""}${selection ? " data-grid-selectable" : ""}`}
      role="table"
      data-testid={testId}
      aria-label={ariaLabel}
      aria-rowcount={paging?.total ?? rows.length}
      onScrollCapture={(event) => {
        if (
          event.target !== headerScroll.current &&
          event.target instanceof HTMLElement &&
          event.target.classList.contains("data-grid-body") &&
          headerScroll.current
        )
          headerScroll.current.scrollLeft = event.target.scrollLeft;
      }}
    >
      {(search || columns.length > 1) && (
        <div className="data-grid-tools">
          {search && (
            <SearchField
              className="data-grid-search"
              label="搜索"
              placeholder={search.placeholder ?? "搜索"}
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
            />
          )}
          {columns.length > 1 && (
            <div className="data-grid-column-menu">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-expanded={showColumns}
                onClick={() => setShowColumns(!showColumns)}
              >
                <Icon name="columns" size={16} />
                <span className="btn-label">显示列</span>
              </button>
              {showColumns && (
                <div
                  className="data-grid-column-options"
                  role="group"
                  aria-label="显示列"
                >
                  {columns.map((column) => (
                    <Checkbox
                      key={column.id}
                      label={column.label}
                      checked={!hidden.has(column.id)}
                      disabled={
                        column.hideable === false ||
                        column.pinned === "start" ||
                        column === columns[0]
                      }
                      onChange={(event) => {
                        const next = new Set(hidden);
                        if (event.target.checked) next.delete(column.id);
                        else next.add(column.id);
                        setHidden(next);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div
        ref={headerScroll}
        className="data-grid-header-scroll"
        data-grid-header
        onScroll={(event) => {
          const body =
            root.current?.querySelector<HTMLElement>(".data-grid-body");
          if (body && body.scrollLeft !== event.currentTarget.scrollLeft)
            body.scrollLeft = event.currentTarget.scrollLeft;
        }}
      >
        <div
          className="data-grid-row data-grid-header"
          role="row"
          style={{ gridTemplateColumns: template, width }}
        >
          {selection && (
            <div
              className="data-grid-cell grid-cell-selection"
              role="columnheader"
            >
              <input
                type="checkbox"
                aria-label="选择当前页全部条目"
                checked={allSelected}
                ref={(node) => {
                  if (node) node.indeterminate = someSelected && !allSelected;
                }}
                onChange={(event) => {
                  const next = new Set(selection.selectedKeys);
                  for (const row of selectable) {
                    if (event.target.checked) next.add(rowKey(row));
                    else next.delete(rowKey(row));
                  }
                  selection.onChange(next);
                }}
              />
            </div>
          )}
          {visible.map((column) => (
            <div
              className={`data-grid-cell${pinned(column)}`}
              role="columnheader"
              aria-sort={
                sort && column.sortable
                  ? sort.columnId === column.id
                    ? sort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                  : undefined
              }
              key={column.id}
            >
              {sort && column.sortable ? (
                <button
                  type="button"
                  className="data-grid-sort"
                  aria-label={`按${column.label}排序`}
                  onClick={() =>
                    sort.onChange(
                      column.id,
                      sort.columnId === column.id && sort.direction === "asc"
                        ? "desc"
                        : "asc",
                    )
                  }
                >
                  {column.label}
                  <span className="data-grid-sort-mark" aria-hidden="true">
                    <Icon
                      size={14}
                      name={
                        sort.columnId === column.id
                          ? sort.direction === "asc"
                            ? "arrow-up"
                            : "arrow-down"
                          : "sort"
                      }
                    />
                  </span>
                </button>
              ) : (
                <span>{column.label}</span>
              )}
            </div>
          ))}
        </div>
      </div>
      {rows.length ? (
        <VirtualList
          items={rows}
          getKey={rowKey}
          height={height === "fill" ? bodyHeight : height}
          estimatedItemHeight={44}
          overscan={216}
          role="rowgroup"
          itemRole="presentation"
          ariaLabel={ariaLabel}
          className="data-grid-body"
          style={{ width: "100%" }}
          renderItem={(row, index) => (
            <div
              className="data-grid-row"
              role="row"
              aria-rowindex={
                (paging ? paging.page * paging.pageSize : 0) + index + 1
              }
              style={{ gridTemplateColumns: template, width }}
            >
              {selection && (
                <div className="data-grid-cell grid-cell-selection" role="cell">
                  <input
                    type="checkbox"
                    aria-label={`选择第${index + 1}行`}
                    disabled={selection.isRowSelectable?.(row) === false}
                    checked={selection.selectedKeys.has(rowKey(row))}
                    onChange={(event) => {
                      const next = new Set(selection.selectedKeys);
                      if (event.target.checked) next.add(rowKey(row));
                      else next.delete(rowKey(row));
                      selection.onChange(next);
                    }}
                  />
                </div>
              )}
              {visible.map((column) => {
                const text = column.longText?.(row);
                return (
                  <div
                    className={`data-grid-cell${pinned(column)}`}
                    role="cell"
                    key={column.id}
                  >
                    {text ? (
                      <button
                        type="button"
                        className="data-grid-cell-expand"
                        title="展开完整内容"
                        onClick={() =>
                          setExpanded({ title: column.label, text })
                        }
                      >
                        {column.render(row)}
                      </button>
                    ) : onRowClick ? (
                      <button
                        type="button"
                        className="data-grid-cell-expand"
                        onClick={() => onRowClick(row)}
                      >
                        {column.render(row)}
                      </button>
                    ) : (
                      <span className="data-grid-cell-content">
                        {column.render(row)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        />
      ) : (
        <StatePanel state="empty" title={empty} />
      )}
      {paging && (
        <div className="data-grid-pager">
          <span className="num">
            共 {paging.total} 条 · 第 {paging.page + 1} / {pageCount} 页
          </span>
          <Button
            size="small"
            variant="secondary"
            icon="back"
            disabled={paging.page <= 0}
            onClick={() => paging.onPageChange(paging.page - 1)}
          >
            上一页
          </Button>
          <Button
            size="small"
            variant="secondary"
            disabled={paging.page >= pageCount - 1}
            onClick={() => paging.onPageChange(paging.page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
      <Dialog
        open={!!expanded}
        title={expanded?.title ?? "完整内容"}
        onClose={() => setExpanded(null)}
      >
        <pre className="data-grid-expanded selectable">{expanded?.text}</pre>
      </Dialog>
    </div>
  );
}
