import { useEffect } from "react";
import {
  useRuntime,
  useClientSnapshot,
} from "../../../platform/react/context.tsx";
import {
  GroupBrowserController,
  CreateGroupController,
  MembersController,
} from "../model/community.ts";
import type {
  BrowserInput,
  CreateInput,
  MembersInput,
} from "../model/community.ts";
import {
  GroupBrowserView,
  CreateGroupSheetView,
  MembersSheetView,
} from "../view/community.tsx";
import { useController } from "../../../platform/react/use-controller.ts";
export function GroupBrowser(input: BrowserInput) {
  const runtime = useRuntime();
  useClientSnapshot();
  const [model] = useController(
    () => new GroupBrowserController(runtime, input),
  );
  useEffect(model.start, [model]);
  useEffect(
    () => model.update(input),
    [model, input.open, input.parent, input.onClose],
  );
  return <GroupBrowserView {...model.presentation()} />;
}
export function CreateGroupSheet(input: CreateInput) {
  const runtime = useRuntime();
  useClientSnapshot();
  const [model] = useController(
    () => new CreateGroupController(runtime, input),
  );
  model.update(input);
  return <CreateGroupSheetView {...model.presentation()} />;
}
export function MembersSheet(input: MembersInput) {
  const runtime = useRuntime();
  const snapshot = useClientSnapshot();
  const [model] = useController(() => new MembersController(runtime, input));
  useEffect(
    () => model.update(input),
    [model, input.open, input.group, input.cached, input.onClose, snapshot],
  );
  useEffect(() => model.dispose, [model]);
  return <MembersSheetView {...model.presentation()} />;
}
