import type { StoredRow } from "../../../core/data/db.ts";
import type {
  RuntimeQueryPort,
  RuntimeNavigationPort,
  RuntimeClockPort,
} from "../../../core/runtime-port.ts";
import {
  conversations,
  states,
  initialState,
  sortedConversations,
} from "./module.ts";
import { chatListTime } from "./format.ts";
import { StateStore } from "../../../core/controller-state.ts";
type ListPort = Pick<RuntimeQueryPort, "getSnapshot"> &
  RuntimeNavigationPort &
  Pick<RuntimeClockPort, "time">;
export class ChatListController extends StateStore<{
  create: boolean;
  find: boolean;
  menu: boolean;
}> {
  constructor(private runtime: ListPort) {
    super({ create: false, find: false, menu: false });
  }
  setCreate = (create: boolean): void => this.patch({ create });
  setFind = (find: boolean): void => this.patch({ find });
  setMenu = (menu: boolean): void => this.patch({ menu });
  open = (id: string): void =>
    this.runtime.dispatch({ type: "openConversation", id });
  presentation(rows: readonly StoredRow[]) {
    const snapshot = this.runtime.getSnapshot(),
      groups = conversations(rows),
      values = states(rows),
      stack = snapshot.nav.areas.chat.stack,
      current = stack[stack.length - 1];
    return {
      ...this.state,
      groups,
      offline: snapshot.status.connection === "offline",
      entries: sortedConversations(groups, values).map((group) => {
        const value =
            values.find((item) => item.conversation === group.id) ??
            initialState(group.id),
          unread = Math.max(0, value.lastSeq - value.readSeq);
        return {
          id: group.id,
          name: group.name,
          avatar: group.name.slice(0, 1),
          hint:
            value.draft.v || value.draftTextId
              ? `草稿：${value.draftTextId ? "长文" : value.draft.v.slice(0, 60)}`
              : value.lastPost?.deletedAt
                ? "消息已删除"
                : value.lastPost?.preview ||
                  (group.type === "announcement" ? "系统公告" : "开始交流"),
          selected: current?.kind === "conversation" && current.id === group.id,
          time: value.lastPost
            ? chatListTime(value.lastPost.created, this.runtime.time())
            : "",
          pinned: value.pin.v,
          muted: value.mute.v,
          unread: unread > 99 ? "99+" : unread || "",
        };
      }),
      setCreate: this.setCreate,
      setFind: this.setFind,
      setMenu: this.setMenu,
      openConversation: this.open,
    };
  }
}
export function chatContent(
  rows: readonly StoredRow[],
  snapshot: ReturnType<RuntimeQueryPort["getSnapshot"]>,
) {
  const stack = snapshot.nav.areas.chat.stack,
    current = stack[stack.length - 1];
  const group =
    current?.kind === "conversation"
      ? conversations(rows).find((value) => value.id === current.id)
      : undefined;
  return {
    group,
    state: group
      ? (states(rows).find((value) => value.conversation === group.id) ??
        initialState(group.id))
      : undefined,
    emptyState: (current?.kind === "conversation"
      ? snapshot.status.connection === "offline"
        ? "offline"
        : "forbidden"
      : "empty") as "offline" | "forbidden" | "empty",
    title: current?.kind === "conversation" ? "对话暂不可用" : "从一段对话开始",
    hint:
      current?.kind === "conversation"
        ? "对话尚未同步，或你已离开这个群组"
        : "选择左侧群组或私信。文字、贴纸与草稿都可以离线保存。",
  };
}
