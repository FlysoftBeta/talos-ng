import { useEffect } from "react";
import {
  useRuntime,
  useClientSnapshot,
} from "../../../platform/react/context.tsx";
import { ConversationController } from "../model/conversation.ts";
import type { ConversationInput } from "../model/conversation.ts";
import { ConversationView } from "../view/conversation.tsx";
import { Composer } from "./composer.tsx";
import { GroupBrowser, MembersSheet } from "./community.tsx";
import { OriginalViewer } from "./media.tsx";
import { PostCard } from "./post-card.tsx";
import { useController } from "../../../platform/react/use-controller.ts";
export function Conversation(input: ConversationInput) {
  const runtime = useRuntime();
  const snapshot = useClientSnapshot();
  const [model] = useController(
    () => new ConversationController(runtime, input),
  );
  model.bind(input);
  useEffect(
    () => model.update(input),
    [model, input.group, input.state, input.rows, snapshot],
  );
  useEffect(() => model.dispose, [model]);
  return (
    <ConversationView
      {...model.presentation()}
      Composer={Composer}
      GroupBrowser={GroupBrowser}
      MembersSheet={MembersSheet}
      OriginalViewer={OriginalViewer}
      PostCard={PostCard}
    />
  );
}
