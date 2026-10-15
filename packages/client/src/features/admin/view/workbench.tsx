import type { ReactElement, ReactNode } from "react";
import {
  EmptyPane,
  Pane,
  PaneBody,
  PaneHeader,
} from "../../../ui/layout/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import type { IconName } from "../../../ui/icon/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import type { WorkbenchSection } from "../model/workbench.ts";

/** Left list of the sections the account may open. */
export function WorkbenchList({
  sections,
  currentId,
  onSelect,
}: {
  sections: readonly WorkbenchSection[];
  currentId: string | undefined;
  onSelect: (id: string) => void;
}): ReactElement {
  return (
    <Pane id="talos-list" className="admin-list">
      <PaneHeader title="管理" />
      <PaneBody>
        <nav aria-label="管理栏目">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className="admin-section"
              aria-label={section.title}
              aria-current={currentId === section.id ? "page" : undefined}
              onClick={() => onSelect(section.id)}
            >
              <Icon name={sectionIcon(section.id)} />
              <span>{section.title}</span>
            </button>
          ))}
        </nav>
      </PaneBody>
    </Pane>
  );
}

/** Content pane when no section is available or admin data cannot be reached. */
export function WorkbenchNotice({
  kind,
}: {
  kind: "forbidden" | "offline" | "unknown";
}): ReactElement {
  return kind === "unknown" ? (
    <StatePanel state="forbidden" />
  ) : kind === "forbidden" ? (
    <StatePanel state="forbidden" hint="当前账号没有管理栏目权限" />
  ) : (
    <StatePanel
      state="offline"
      title="离线不可用"
      hint="管理数据仅在连接服务器时提供。"
    />
  );
}

export function WorkbenchOverview({
  roles,
}: {
  roles: readonly string[];
}): ReactElement {
  return (
    <EmptyPane
      icon="admin"
      hint={roles.length ? "管理工作台 · 选择左侧栏目" : "暂无管理栏目"}
    />
  );
}

/** Titled pane around a panel contributed by another feature. */
export function AdminPanelFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <Pane className="admin-pane" aria-label={title}>
      {children}
    </Pane>
  );
}

function sectionIcon(id: string): IconName {
  const icons: Record<string, IconName> = {
    overview: "admin",
    users: "users",
    invitations: "ticket",
    devices: "device",
    groups: "hash",
    announcements: "announce",
    system: "sliders",
    incidents: "bug",
    audit: "audit",
    debug: "settings",
  };
  return icons[id] ?? (id.includes("ai") ? "coins" : "server");
}
