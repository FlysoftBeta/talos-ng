import type { ChatState } from "@talos/contract";
export function initialChatState(conversation: string): ChatState {
  const zero = { t: { ms: 0, counter: 0 }, op: "00000000000000000000000000" };
  return {
    id: conversation,
    conversation,
    readSeq: 0,
    pin: { v: false, ...zero },
    mute: { v: false, ...zero },
    draft: { v: "", ...zero },
    draftTextId: null,
    retention: { v: "auto", ...zero },
    lastSeq: 0,
    lastPost: null,
    updated: 0,
    mutedUntil: 0,
  };
}
