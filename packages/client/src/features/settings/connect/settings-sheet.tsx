import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { contract } from "@talos/contract";
import {
  useCan,
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import { preferenceRows } from "../model/preferences.ts";
import {
  SettingsController,
  aboutRows,
  confirmDialog,
} from "../model/settings-sheet.ts";
import { SettingsSheetView } from "../view/settings-sheet.tsx";
import { PinReplacement } from "./pin-replacement.tsx";
import { ProfileSettings } from "./profile.tsx";

export function SettingsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactElement {
  const runtime = useRuntime();
  const snapshot = useClientSnapshot();
  const permission = useCan(contract.me.setting.set);
  const pinPermission = useCan(contract.identity.pins.replace);
  const logoutPermission = useCan(contract.auth.logout);
  const [controller] = useState(() => new SettingsController(runtime));
  const { sheet, busy, error, allOperations } = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const unsynced =
    allOperations ?? snapshot.status.pending + snapshot.status.failed;
  return (
    <SettingsSheetView
      open={open}
      preferences={preferenceRows(runtime)}
      preferencesDenied={permission.ok ? undefined : permission.reason}
      accountActions={{
        pinsDenied: pinPermission.ok ? undefined : pinPermission.reason,
        logoutDenied: logoutPermission.ok ? undefined : logoutPermission.reason,
        onLock: () => runtime.lock(),
        onPins: controller.openPins,
        onLogout: controller.openLogout,
        onAbout: controller.openAbout,
        onReset: controller.openReset,
      }}
      profile={open && <ProfileSettings key={snapshot.user?.id} />}
      error={error}
      about={{
        open: open && sheet === "about",
        rows: aboutRows({
          build: snapshot.status.build,
          device: snapshot.device,
          storage: snapshot.status.storage,
          origin: location.origin,
          userAgent: navigator.userAgent,
        }),
        onClose: controller.close,
      }}
      confirmation={{
        open: open && (sheet === "reset" || sheet === "logout"),
        busy,
        copy: confirmDialog(
          sheet === "reset" ? "reset" : "logout",
          snapshot.user?.name,
          busy,
          unsynced,
        ),
        onDismiss: controller.dismissConfirmation,
        onConfirm: () => void controller.confirm(),
      }}
      pins={
        open &&
        sheet === "pins" && <PinReplacement onClose={controller.close} />
      }
      onClose={onClose}
      onPreference={controller.choose}
    />
  );
}
