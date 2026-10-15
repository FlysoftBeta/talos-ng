import type { ReactElement } from "react";
import { useRuntime } from "../../../platform/react/context.tsx";
import { downloadUrl, raiseClientFault } from "../adapters/browser-effects.ts";
import { IncidentsController } from "../model/incidents.ts";
import { IncidentsView } from "../view/incidents.tsx";
import { useController } from "../../../platform/react/use-controller.ts";

const effects = { download: downloadUrl, raiseClientFault };

export function IncidentsPanel(): ReactElement {
  const runtime = useRuntime();
  const [controller, state] = useController(
    () => new IncidentsController(runtime, effects),
  );
  return (
    <IncidentsView
      state={state}
      rows={controller.rows()}
      actions={controller}
    />
  );
}
