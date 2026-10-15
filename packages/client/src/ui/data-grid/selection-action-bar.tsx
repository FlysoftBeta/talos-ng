import type { ReactElement, ReactNode } from "react";
import "./data-grid.css";
/** Appears above a grid while rows are selected: count, bulk actions, clear. */
export function SelectionActionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="selection-bar" role="group" aria-label="批量操作">
      <span className="selection-count num">已选择 {count} 项</span>
      <div className="selection-actions">{children}</div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
        <span className="btn-label">取消选择</span>
      </button>
    </div>
  );
}
