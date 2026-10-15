import { useEffect, useRef, useState } from "react";
import {
  useRuntime,
  useClientSnapshot,
} from "../../../platform/react/context.tsx";
import type { VirtualListHandle } from "../../../ui/virtual/index.ts";
import { ConversationController } from "../model/conversation.ts";
import type { ConversationInput } from "../model/conversation.ts";
import {
  conversationViewport,
  observeConversationHeight,
} from "../adapters/viewport.ts";
import { ConversationView } from "../view/conversation.tsx";
import { Composer } from "./composer.tsx";
import { GroupBrowser, MembersSheet } from "./community.tsx";
import { OriginalViewer } from "./media.tsx";
import { PostCard } from "./post-card.tsx";
import { useController } from "../../../platform/react/use-controller.ts";
export function Conversation(input: ConversationInput) {
  const runtime = useRuntime();
  const snapshot = useClientSnapshot();
  const list = useRef<VirtualListHandle>(null),
    viewport = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(420);
  const [model] = useController(
    () =>
      new ConversationController(
        runtime,
        input,
        conversationViewport(
          () => list.current,
          () => viewport.current,
        ),
      ),
  );
  model.bind(input);
  useEffect(
    () => observeConversationHeight(() => viewport.current, setHeight),
    [],
  );
  useEffect(
    () => model.update(input),
    [model, input.group, input.state, input.rows, snapshot],
  );
  useEffect(() => model.visibleRead(), [model, input.rows, height]);
  useEffect(() => model.dispose, [model]);
  return (
    <ConversationView
      {...model.presentation()}
      height={height}
      list={list}
      viewport={viewport}
      boundary={model.boundary}
      Composer={Composer}
      GroupBrowser={GroupBrowser}
      MembersSheet={MembersSheet}
      OriginalViewer={OriginalViewer}
      PostCard={PostCard}
    />
  );
}
