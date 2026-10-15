import { useState } from "react";
import type { ReactElement } from "react";
import { useRuntime, useRepository } from "../../../platform/react/context.tsx";
import { AiListController } from "../model/conversation-list.ts";
import { ConversationListView } from "../view/conversation-list.tsx";
import { useController } from "../../../platform/react/use-controller.ts";

import { aiRowSource, creditOf, conversationsOf } from "../model/rows.ts";
import { WorkspaceSheet } from "./workspace.tsx";

export function AiList(): ReactElement {
  const runtime = useRuntime(),
    [controller, state] = useController(() => new AiListController(runtime));
  const rows = useRepository(aiRowSource(runtime));
  const [open, setOpen] = useState(false);
  return (
    <ConversationListView
      state={state}
      credit={creditOf(rows)}
      conversations={conversationsOf(rows)}
      onWorkspace={() => setOpen(true)}
      workspace={<WorkspaceSheet open={open} onClose={() => setOpen(false)} />}
      onQuery={controller.setQuery}
      onCreate={controller.create}
      onOpen={controller.open}
    />
  );
}
