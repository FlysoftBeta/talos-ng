import type { ReactElement } from "react";
import { useRuntime } from "../../../platform/react/context.tsx";
import { GroupsController } from "../model/groups.ts";
import { GroupEditorSheet } from "../view/group-editor.tsx";
import { GroupMembersSheet } from "../view/group-members.tsx";
import { GroupsView } from "../view/groups.tsx";
import { useController } from "../../../platform/react/use-controller.ts";

export function GroupsPanel(): ReactElement {
  const runtime = useRuntime();
  const [controller, state] = useController(
    () => new GroupsController(runtime),
  );
  return (
    <GroupsView state={state} actions={controller}>
      <GroupEditorSheet
        state={state}
        kind={controller.editorKind()}
        canSave={controller.canSave()}
        actions={controller}
      />
      <GroupMembersSheet
        state={state}
        rows={controller.memberRows()}
        canAdd={controller.canAddMember()}
        actions={controller}
      />
    </GroupsView>
  );
}
