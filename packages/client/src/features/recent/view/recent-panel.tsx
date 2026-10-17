import type { ReactElement } from "react";
import { Icon } from "../../../ui/icon/index.ts";
import type { IconName } from "../../../ui/icon/index.ts";
import { Pane, PaneBody, PaneHeader } from "../../../ui/layout/index.ts";
import { ListRow, StatePanel } from "../../../ui/feedback/index.ts";

export interface RecentRowView {
  id: string;
  title: string;
  hint: string;
  /** Kind label, e.g. 对话 or 歌单. */
  label: string;
  icon: IconName;
  onOpen(): void;
}

/** The global recent list: one ranked list across every module, with an empty state. */
export function RecentPanelView({
  rows,
}: {
  rows: readonly RecentRowView[];
}): ReactElement {
  return (
    <Pane className="recent-panel" data-testid="recent.list">
      <PaneHeader title="最近使用" />
      <PaneBody>
        {!rows.length && (
          <StatePanel
            state="empty"
            title="还没有使用记录"
            hint="打开对话、文档、书单、歌曲或歌单后会出现在这里"
          />
        )}
        {rows.map((row) => (
          <ListRow
            key={row.id}
            title={row.title}
            hint={`${row.label} · ${row.hint}`}
            leading={<Icon name={row.icon} size={18} />}
            onClick={row.onOpen}
          />
        ))}
      </PaneBody>
    </Pane>
  );
}
