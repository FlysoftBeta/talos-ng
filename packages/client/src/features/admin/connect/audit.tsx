import type { ReactElement } from "react";
import { useRuntime } from "../../../platform/react/context.tsx";
import { AuditController } from "../model/audit.ts";
import { AuditView } from "../view/audit.tsx";
import { useController } from "../../../platform/react/use-controller.ts";

export function AuditPanel(): ReactElement {
  const runtime = useRuntime();
  const [controller, state] = useController(() => new AuditController(runtime));
  return (
    <AuditView state={state} rows={controller.rows()} actions={controller} />
  );
}
