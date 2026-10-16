import type { ReactElement } from "react";
import { useClientSnapshot } from "../platform/react/context.tsx";
import {
  LibraryContent,
  LibraryList,
  useLibrary,
  writableCollections,
} from "../features/library/index.ts";
import { AdminPanelFrame } from "../features/admin/index.tsx";
import type { AdminExtension } from "../features/admin/index.tsx";
import { aiAdminPanels } from "../features/ai/index.ts";
import { OpsLiveProvider, opsPanels } from "../features/ops/index.ts";
import { NetbooksEntry } from "../features/netbooks/index.ts";
import { ReaderScreen } from "../features/reader/index.ts";
import { ChatContent } from "../features/chat/connect/index.tsx";
import { RecentHome } from "./recent.tsx";

/** Library list with network books on its toolbar; booklists a user may write are the destinations. */
export function LibraryAreaList(): ReactElement {
  const user = useClientSnapshot().user,
    data = useLibrary();
  return (
    <LibraryList
      toolbarExtra={
        <NetbooksEntry
          destinations={user ? writableCollections(data, user.id) : []}
        />
      }
    />
  );
}
/** Chat content; the landing page (no conversation open) hosts the global recent panel. */
export function ChatAreaContent(): ReactElement {
  const stack = useClientSnapshot().nav.areas.chat.stack;
  return stack[stack.length - 1]?.kind === "home" ? (
    <RecentHome />
  ) : (
    <ChatContent />
  );
}
/** Library content with the reader supplied for open documents. */
export function LibraryAreaContent(): ReactElement {
  return (
    <LibraryContent
      renderDocument={(id) => <ReaderScreen key={id} id={id} />}
    />
  );
}

/** Panels other features contribute to the admin workbench: AI billing and the ops sections. */
export const adminExtensions: readonly AdminExtension[] = [
  ...aiAdminPanels.map((panel) => ({
    id: `ai:${panel.id}`,
    title: panel.title,
    roles: [panel.requiredRole],
    render: () => <panel.component />,
  })),
  ...opsPanels.map((panel) => ({
    id: `ops:${panel.id}`,
    title: `运维 · ${panel.title}`,
    roles: [panel.requiredRole],
    render: () => (
      <OpsLiveProvider>
        <AdminPanelFrame title={`运维 · ${panel.title}`}>
          <panel.component />
        </AdminPanelFrame>
      </OpsLiveProvider>
    ),
  })),
];
