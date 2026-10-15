import type { ReactElement } from "react";
import { Pane, PaneBody, PaneHeader } from "../../../ui/layout/index.ts";
import { ListRow } from "../../../ui/feedback/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import type { IconName } from "../../../ui/icon/icon.tsx";
import type { SidebarItem, SidebarModel } from "../model/pages.ts";
import "./learning.css";

const icons: Record<SidebarItem["id"], IconName> = {
  dashboard: "target",
  wrong: "xcircle",
  mastered: "check-circle",
};
export function SidebarView({
  model,
  counts,
  onOpen,
}: {
  model: SidebarModel;
  /** Word counts shown beside the list entries. */
  counts: { wrong: number; mastered: number };
  onOpen: (id: string) => void;
}): ReactElement {
  return (
    <Pane className="learn-nav">
      <PaneHeader title="学习" />
      <PaneBody className="learn-nav-body">
        {model.items.map((item) => (
          <ListRow
            key={item.id}
            title={item.title}
            selected={item.selected}
            leading={<Icon name={icons[item.id]} size={18} />}
            meta={
              item.id === "dashboard" ? undefined : (
                <span className="learn-count">{counts[item.id]}</span>
              )
            }
            onClick={() => onOpen(item.id)}
          />
        ))}
      </PaneBody>
      <p className="learn-nav-note">{model.cache}</p>
    </Pane>
  );
}
