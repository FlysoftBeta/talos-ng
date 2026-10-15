import type { ReactElement } from "react";
import { HttpsController } from "../model/https.ts";
import { HttpsView } from "../view/https.tsx";
import { useController } from "../../../platform/react/use-controller.ts";
import { useOpsPort } from "./port.tsx";

export function HttpsPanel(): ReactElement {
  const port = useOpsPort();
  const [controller] = useController(() => new HttpsController(port));
  return <HttpsView model={controller.model()} actions={controller} />;
}
