import { useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { contract } from "@talos/contract";
import { useCan, useRuntime } from "../../../platform/react/context.tsx";
import {
  InvitationController,
  formatInvitationExpiry,
} from "../model/invitation.ts";
import { InvitationSheetView } from "../view/invitation.tsx";

/** Minimal admission administration; the full workbench is a later feature. */
export function InvitationSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
}): ReactElement {
  const runtime = useRuntime();
  const permission = useCan(contract.identity.invitation.create);
  const [controller] = useState(() => new InvitationController(runtime));
  const { invitation, busy, error } = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  return (
    <InvitationSheetView
      open={open}
      busy={busy}
      error={error}
      denied={permission.ok ? undefined : permission.reason}
      pin={invitation?.pin}
      expires={invitation && formatInvitationExpiry(invitation.expires)}
      onClose={onClose}
      onCreate={() => {
        void controller.create();
      }}
    >
      {children}
    </InvitationSheetView>
  );
}
