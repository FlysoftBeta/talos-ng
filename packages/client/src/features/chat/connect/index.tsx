import { useEffect } from "react";
import {
  useRuntime,
  useClientSnapshot,
  useRepository,
} from "../../../platform/react/context.tsx";
import {
  states,
  conversations,
  unreadCount,
  unreadStates,
} from "../model/module.ts";
import { ChatListController, chatContent } from "../model/chat-list.ts";
import { BackgroundController } from "../model/background.ts";
import {
  ChatListView,
  ChatContentView,
  ChatBackgroundView,
} from "../view/index.tsx";
import { CreateGroupSheet, GroupBrowser } from "./community.tsx";
import { Conversation } from "./conversation.tsx";
import { useRetention } from "./retention.ts";
import { useController } from "../../../platform/react/use-controller.ts";
export function useChatRows() {
  const runtime = useRuntime();
  return useRepository(runtime.repositories.get("chat.rows")!);
}
/** Conversations visible to the user (for cross-feature lists such as recents). */
export function useConversations() {
  return conversations(useChatRows());
}
/** Unread count and newest unread message time per conversation id (muted ones omitted). */
export function useUnreadSignals(): Record<
  string,
  { count: number; newestAt: number }
> {
  const out: Record<string, { count: number; newestAt: number }> = {};
  for (const { state, count } of unreadStates(useChatRows()))
    if (state.lastPost)
      out[state.conversation] = { count, newestAt: state.lastPost.created };
  return out;
}
export function useChatUnread(): number {
  return unreadCount(useChatRows());
}
export function ChatList() {
  const runtime = useRuntime();
  useClientSnapshot();
  const rows = useChatRows();
  const [model] = useController(() => new ChatListController(runtime));
  return (
    <ChatListView
      {...model.presentation(rows)}
      CreateGroupSheet={CreateGroupSheet}
      GroupBrowser={GroupBrowser}
    />
  );
}
export function ChatContent() {
  const snapshot = useClientSnapshot(),
    rows = useChatRows(),
    content = chatContent(rows, snapshot);
  return (
    <ChatContentView content={content}>
      {content.group && content.state ? (
        <Conversation
          key={content.group.id}
          group={content.group}
          state={content.state}
          rows={rows}
        />
      ) : undefined}
    </ChatContentView>
  );
}
export function ChatBackground() {
  const runtime = useRuntime(),
    snapshot = useClientSnapshot(),
    rows = useChatRows();
  useRetention(states(rows), conversations(rows), rows);
  const [model] = useController(() => new BackgroundController(runtime));
  useEffect(() => model.update(rows), [model, rows, snapshot]);
  useEffect(() => model.dispose, [model]);
  return <ChatBackgroundView {...model.presentation()} />;
}
