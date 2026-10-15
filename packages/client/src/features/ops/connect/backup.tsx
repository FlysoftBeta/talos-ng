import type { ReactElement } from "react";
import { browserDownloads } from "../adapters/browser-effects.ts";
import { BackupController } from "../model/backup.ts";
import { BackupView } from "../view/backup.tsx";
import { useController } from "../../../platform/react/use-controller.ts";
import { useOpsPort } from "./port.tsx";

export function BackupPanel(): ReactElement {
  const port = useOpsPort();
  const [controller] = useController(
    () => new BackupController(port, browserDownloads),
  );
  return <BackupView model={controller.model()} actions={controller} />;
}
