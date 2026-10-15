import type { ReactElement } from "react";
import {
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import { isRoot } from "../model/access.ts";
import { DebugController } from "../model/debug.ts";
import { DebugView } from "../view/debug.tsx";
import { useController } from "../../../platform/react/use-controller.ts";

export function DebugPanel(): ReactElement {
  const runtime = useRuntime();
  const snapshot = useClientSnapshot();
  const [controller, state] = useController(() => new DebugController(runtime));
  return (
    <DebugView
      root={isRoot(snapshot.user)}
      device={snapshot.device}
      connection={snapshot.status.connection}
      offline={state.offline}
      onToggle={controller.toggle}
    />
  );
}
