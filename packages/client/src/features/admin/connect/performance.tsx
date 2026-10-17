import type { ReactElement } from "react";
import { useRuntime } from "../../../platform/react/context.tsx";
import { PerformanceController } from "../model/performance.ts";
import { PerformanceView } from "../view/performance.tsx";
import { useController } from "../../../platform/react/use-controller.ts";

export function PerformancePanel(): ReactElement {
  const runtime = useRuntime();
  const [controller, state] = useController(
    () => new PerformanceController(runtime),
  );
  return (
    <PerformanceView
      state={state}
      statements={controller.statements()}
      slow={controller.slow()}
      actions={controller}
    />
  );
}
