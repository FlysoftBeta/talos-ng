import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { GrantController, principalKey } from "./model.ts";
import type { SharingAdapter } from "./model.ts";
import { GrantSheetView } from "./view.tsx";

export function GrantSheet({
  title,
  adapter,
  reason,
  onClose,
}: {
  title: string;
  adapter: SharingAdapter;
  reason?: string;
  onClose: () => void;
}): ReactElement {
  const controller = useMemo(() => new GrantController(adapter), [adapter]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  useEffect(() => {
    void controller.refresh();
  }, [controller]);
  return (
    <GrantSheetView
      title={title}
      reason={reason}
      state={state}
      onClose={onClose}
      onRetry={() => void controller.refresh()}
      onSelect={controller.select}
      onLevel={controller.setLevel}
      onDelegate={controller.setDelegate}
      onGrant={() => void controller.grant()}
      onChangeLevel={(grant, level) => {
        controller.select(
          principalKey({ id: grant.principal, type: grant.principalType }),
        );
        controller.setLevel(level);
        controller.setDelegate(grant.delegate);
        void controller.grant();
      }}
      onAskRevoke={controller.askRevoke}
      onCancelRevoke={controller.cancelRevoke}
      onConfirmRevoke={() => void controller.confirmRevoke()}
    />
  );
}
