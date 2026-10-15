import type { ReactElement } from "react";
import { useRuntime } from "../../../platform/react/context.tsx";
import { AnnouncementsController } from "../model/announcements.ts";
import { AnnouncementsView } from "../view/announcements.tsx";
import { useController } from "../../../platform/react/use-controller.ts";

export function AnnouncementsPanel(): ReactElement {
  const runtime = useRuntime();
  const [controller, state] = useController(
    () => new AnnouncementsController(runtime),
  );
  return (
    <AnnouncementsView
      state={state}
      canPublish={controller.canPublish()}
      actions={controller}
    />
  );
}
