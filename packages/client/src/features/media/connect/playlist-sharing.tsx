import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { GrantController } from "../../sharing/model.ts";
import type { SharingAdapter } from "../../sharing/index.ts";
import { PlaylistSharingView } from "../view/playlist-sharing.tsx";

export function PlaylistSharing({
  title,
  adapter,
  onClose,
}: {
  title: string;
  adapter: SharingAdapter;
  onClose(): void;
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
    <PlaylistSharingView
      title={title}
      state={state}
      onClose={onClose}
      onSelect={controller.select}
      onLevel={controller.setLevel}
      onGrant={() => void controller.grant()}
      onRetry={() => void controller.refresh()}
      onRevoke={controller.askRevoke}
      onCancel={controller.cancelRevoke}
      onConfirm={() => void controller.confirmRevoke()}
    />
  );
}
