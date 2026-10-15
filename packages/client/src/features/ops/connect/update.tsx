import type { ReactElement } from "react";
import { fileSource } from "../adapters/browser-effects.ts";
import { UpdateController } from "../model/update.ts";
import { UpdateView } from "../view/update.tsx";
import { useController } from "../../../platform/react/use-controller.ts";
import { useOpsPort } from "./port.tsx";

export function UpdatePanel(): ReactElement {
  const port = useOpsPort();
  const [controller] = useController(() => new UpdateController(port));
  return (
    <UpdateView
      model={controller.model()}
      actions={controller}
      onFile={(file) => controller.setFile(file && fileSource(file))}
    />
  );
}
