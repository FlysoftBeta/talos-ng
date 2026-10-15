import { useEffect } from "react";
import type { ReactElement } from "react";
import { useRuntime } from "../../../platform/react/context.tsx";
import { WorkspaceController } from "../model/workspace.ts";
import { WorkspaceSheetView } from "../view/workspace.tsx";
import { RichText } from "./rich-text.tsx";
import { useController } from "../../../platform/react/use-controller.ts";

export function WorkspaceSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactElement {
  const runtime = useRuntime(),
    [controller, state] = useController(() => new WorkspaceController(runtime));
  useEffect(() => controller.setOpen(open), [controller, open]);
  return (
    <WorkspaceSheetView
      open={open}
      onClose={onClose}
      state={state}
      actions={controller}
      renderMarkdown={(text) => <RichText text={text} complete />}
    />
  );
}
