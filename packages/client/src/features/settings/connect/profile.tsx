import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { contract } from "@talos/contract";
import {
  useCan,
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import { ProfileController, canSaveProfile } from "../model/profile.ts";
import { ProfileSettingsView } from "../view/profile.tsx";
export function ProfileSettings(): ReactElement {
  const runtime = useRuntime();
  const { user } = useClientSnapshot();
  const permission = useCan(contract.identity.profile.update);
  const [controller] = useState(() => new ProfileController(runtime, user));
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  return (
    <ProfileSettingsView
      handle={state.handle}
      name={state.name}
      busy={state.busy}
      message={state.message}
      denied={permission.ok ? undefined : permission.reason}
      canSave={canSaveProfile(state, user, permission.ok)}
      onHandle={controller.setHandle}
      onName={controller.setName}
      onSave={() => void controller.save()}
    />
  );
}
