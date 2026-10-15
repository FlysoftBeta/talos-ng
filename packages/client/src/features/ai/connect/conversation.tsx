import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { ai } from "@talos/contract";
import type { AiMessage } from "@talos/contract";
import {
  useCan,
  useClientSnapshot,
  useRepository,
  useRuntime,
} from "../../../platform/react/context.tsx";
import { EmptyPane } from "../../../ui/layout/index.ts";
import { browserImageFiles } from "../adapters/browser-files.ts";
import {
  ConversationController,
  MessageTextController,
  messageInFlight,
} from "../model/conversation.ts";
import {
  aiRowSource,
  currentConversationId,
  findConversation,
} from "../model/rows.ts";
import { ConversationView } from "../view/conversation.tsx";
import { useController } from "../../../platform/react/use-controller.ts";
import { RichText } from "./rich-text.tsx";
import { WorkspaceSheet } from "./workspace.tsx";

export function AiContent(): ReactElement {
  const runtime = useRuntime(),
    snapshot = useClientSnapshot(),
    rows = useRepository(aiRowSource(runtime)),
    c = findConversation(
      rows,
      currentConversationId(snapshot.nav.areas.ai.stack),
    );
  if (!c) return <EmptyPane icon="ai" hint="开始一段新对话" />;
  return <Conversation key={c.id} id={c.id} />;
}
function Conversation({ id }: { id: string }): ReactElement {
  const runtime = useRuntime(),
    [controller, state] = useController(
      () => new ConversationController<File>(runtime, id, browserImageFiles),
    );
  return (
    <ConversationView
      state={state}
      transcript={controller.transcript}
      actions={{
        onText: controller.setText,
        onSend: () => void controller.send(),
        onStop: controller.stop,
        onFork: controller.fork,
        onAddImage: controller.addImage,
        onRemoveImage: controller.removeImage,
        onSaveDetails: controller.saveDetails,
      }}
      messageBody={(m) => <MessageText key={m.id} message={m} />}
      workspace={({ open, onClose }) => (
        <WorkspaceSheet open={open} onClose={onClose} />
      )}
    />
  );
}
function MessageText({ message: m }: { message: AiMessage }): ReactElement {
  const runtime = useRuntime(),
    can = useCan(ai.content.fetch),
    [controller] = useState(() => new MessageTextController(runtime, m)),
    { text } = useSyncExternalStore(
      controller.subscribe,
      controller.getState,
      controller.getState,
    );
  useEffect(() => {
    controller.update(m);
    return () => controller.cancel();
  }, [m.rev, can.ok]);
  return m.role === "assistant" ? (
    <RichText text={text} complete={!messageInFlight(m.status)} />
  ) : (
    <p className="selectable ai-user-text">{text}</p>
  );
}
