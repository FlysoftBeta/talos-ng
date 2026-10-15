import type { ReactElement } from "react";
import { useRuntime } from "../../../platform/react/context.tsx";
import { DevicesController } from "../model/devices.ts";
import { DevicesView } from "../view/devices.tsx";
import { useController } from "../../../platform/react/use-controller.ts";

export function DevicesPanel(): ReactElement {
  const runtime = useRuntime();
  const [controller, state] = useController(
    () => new DevicesController(runtime),
  );
  return <DevicesView state={state} actions={controller} />;
}
