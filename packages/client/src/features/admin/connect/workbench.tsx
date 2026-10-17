import { useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { useClientSnapshot } from "../../../platform/react/context.tsx";
import {
  BUILT_IN_SECTIONS,
  WorkbenchController,
  allowedSections,
  currentSection,
  workbenchContent,
} from "../model/workbench.ts";
import type { WorkbenchSection } from "../model/workbench.ts";
import {
  WorkbenchList,
  WorkbenchNotice,
  WorkbenchOverview,
} from "../view/workbench.tsx";
import { AnnouncementsPanel } from "./announcements.tsx";
import { AuditPanel } from "./audit.tsx";
import { DebugPanel } from "./debug.tsx";
import { DevicesPanel } from "./devices.tsx";
import { GroupsPanel } from "./groups.tsx";
import { IncidentsPanel } from "./incidents.tsx";
import { InvitationsPanel } from "./invitations.tsx";
import { SystemPanel } from "./system.tsx";
import { UsersPanel } from "./users.tsx";

/** A section contributed by another feature; the application composition supplies it. */
export interface AdminExtension extends WorkbenchSection {
  render(): ReactElement;
}

const builtIn: Record<string, () => ReactElement> = {
  users: UsersPanel,
  invitations: InvitationsPanel,
  devices: DevicesPanel,
  groups: GroupsPanel,
  announcements: AnnouncementsPanel,
  system: SystemPanel,
  audit: AuditPanel,
  incidents: IncidentsPanel,
  debug: DebugPanel,
};

/** The workbench is online only; no admin response enters the sync cache. */
export function useAdminWorkbench(extensions: readonly AdminExtension[]): {
  list: ReactNode;
  content: ReactNode;
} {
  const snapshot = useClientSnapshot();
  const [controller] = useState(() => new WorkbenchController());
  const { selected } = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const sections = useMemo(
    () => [...BUILT_IN_SECTIONS, ...extensions],
    [extensions],
  );
  const roles = snapshot.user?.roles ?? [];
  const allowed = allowedSections(sections, roles);
  const current = currentSection(allowed, selected);
  const notice = workbenchContent(
    current,
    snapshot.status.connection === "connected",
  );
  return {
    list: (
      <WorkbenchList
        sections={allowed}
        currentId={current?.id}
        onSelect={controller.select}
      />
    ),
    content:
      notice !== "section" ? (
        <WorkbenchNotice kind={notice} />
      ) : (
        <AdminSection
          key={current!.id}
          id={current!.id}
          extensions={extensions}
          roles={roles}
        />
      ),
  };
}

function AdminSection({
  id,
  extensions,
  roles,
}: {
  id: string;
  extensions: readonly AdminExtension[];
  roles: readonly string[];
}): ReactElement {
  const extension = extensions.find((item) => item.id === id);
  if (extension) return extension.render();
  if (id === "overview") return <WorkbenchOverview roles={roles} />;
  const Panel = builtIn[id];
  return Panel ? <Panel /> : <WorkbenchNotice kind="unknown" />;
}
