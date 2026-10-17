import type { ReactElement } from "react";
import { Icon } from "../../../ui/icon/index.ts";
import type { IconName } from "../../../ui/icon/index.ts";
import { Pane, PaneBody, PaneHeader } from "../../../ui/layout/index.ts";
import { EmptyPane } from "../../../ui/layout/index.ts";
import { ListRow } from "../../../ui/feedback/index.ts";

export interface RecentRowView {
  id: string;
  title: string;
  hint: string;
  /** Kind label, e.g. 对话 or 歌单. */
  label: string;
  icon: IconName;
  onOpen(): void;
}

/** The global recent panel: one list across every module; the empty state is the plain landing hint. */
export function RecentPanelView({
  rows,
  emptyHint,
}: {
  rows: readonly RecentRowView[];
  emptyHint: string;
}): ReactElement {
  if (!rows.length) return <EmptyPane icon="chat" hint={emptyHint} />;
  return (
    <Pane className="recent-panel">
      <PaneHeader title="最近使用" />
      <PaneBody>
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
