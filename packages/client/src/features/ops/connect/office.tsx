import type { ReactElement } from "react";
import { browserDownloads } from "../adapters/browser-effects.ts";
import { OfficeController } from "../model/office.ts";
import { OfficeView } from "../view/office.tsx";
import { useController } from "../../../platform/react/use-controller.ts";
import { useOpsPort } from "./port.tsx";

export function OfficePanel(): ReactElement {
  const port = useOpsPort();
  const [controller] = useController(
    () => new OfficeController(port, browserDownloads),
  );
  return <OfficeView model={controller.model()} actions={controller} />;
}
