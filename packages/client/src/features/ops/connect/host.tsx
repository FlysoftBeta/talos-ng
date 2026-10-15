import type { ReactElement } from "react";
import { HostController } from "../model/host.ts";
import { HostView } from "../view/host.tsx";
import { useController } from "../../../platform/react/use-controller.ts";
import { useOpsPort } from "./port.tsx";

export function HostPanel(): ReactElement {
  const port = useOpsPort();
  const [controller] = useController(() => new HostController(port));
  return <HostView model={controller.model()} actions={controller} />;
}
