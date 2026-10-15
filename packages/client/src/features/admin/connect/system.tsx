import type { ReactElement } from "react";
import { useRuntime } from "../../../platform/react/context.tsx";
import { SystemController } from "../model/system.ts";
import { SystemView } from "../view/system.tsx";
import { useController } from "../../../platform/react/use-controller.ts";

export function SystemPanel(): ReactElement {
  const runtime = useRuntime();
  const [controller, state] = useController(
    () => new SystemController(runtime),
  );
  return <SystemView state={state} actions={controller} />;
}
