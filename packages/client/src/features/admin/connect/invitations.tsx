import type { ReactElement } from "react";
import { useRuntime } from "../../../platform/react/context.tsx";
import { InvitationsController } from "../model/invitations.ts";
import { InvitationsView } from "../view/invitations.tsx";
import { useController } from "../../../platform/react/use-controller.ts";

export function InvitationsPanel(): ReactElement {
  const runtime = useRuntime();
  const [controller, state] = useController(
    () => new InvitationsController(runtime),
  );
  return (
    <InvitationsView
      state={state}
      rows={controller.rows()}
      actions={controller}
    />
  );
}
