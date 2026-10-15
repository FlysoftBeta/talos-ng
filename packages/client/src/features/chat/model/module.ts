import {
  contract,
  postSchema,
  chatStateSchema,
  communityConversationSchema,
  communityMemberSchema,
} from "@talos/contract";
import type {
  ChatState,
  ChatPost,
  CommunityConversation,
  CommunityMember,
} from "@talos/contract";
import { ulidTime } from "@talos/base";
import { lwwMerge } from "@talos/sync";
import { defineClientModule } from "../../../core/data/modules.ts";
import type { StoredRow } from "../../../core/data/db.ts";
const ZERO = "00000000000000000000000000";
export function initialState(conversation: string): ChatState {
  const base = { t: { ms: 0, counter: 0 }, op: ZERO };
  return {
    id: conversation,
    conversation,
    readSeq: 0,
    pin: { ...base, v: false },
    mute: { ...base, v: false },
    draft: { ...base, v: "" },
    draftTextId: null,
    retention: { ...base, v: "auto" },
    lastSeq: 0,
    lastPost: null,
    updated: 0,
    mutedUntil: 0,
  };
}
function updateState(
  rows: readonly StoredRow[],
  user: string,
  conversation: string,
  update: (value: ChatState) => ChatState,
): readonly StoredRow[] {
  const previous = rows.find(
    (row) =>
      row.scope === `me:${user}` &&
      row.type === "chatState" &&
      row.id === conversation,
  );
  const parsed = chatStateSchema.safeParse(previous?.data);
  return [
    ...rows.filter((row) => row !== previous),
    {
      scope: `me:${user}`,
      type: "chatState",
      id: conversation,
      rev: previous?.rev ?? 0,
      deleted: false,
      data: update(parsed.success ? parsed.data : initialState(conversation)),
    },
  ];
}
export const chatModule = defineClientModule({
  id: "chat",
  operationTitles: {
    "chat.post.send": "发送消息",
    "chat.text.put": "保存长文本",
    "chat.state.set": "更新对话设置或草稿",
    "chat.state.read": "保存已读进度",
    "chat.announcement.ack": "确认已读公告",
  },
  rowTypes: [
    "communityConversation",
    "communityMember",
    "communitySelf",
    "post",
    "chatState",
    "announcement",
    "announcementAck",
  ],
  windowed: {
    post: {
      seqOf: (row: { data: unknown }): number => postSchema.parse(row.data).seq,
    },
  },
  reducers: {
    "chat.text.put": (rows) => rows,
    "chat.state.set": (rows, args, { user }) => {
      const parsed = contract.chat.state.set.args.safeParse(args);
      if (!parsed.success) return rows;
      const input = parsed.data;
      return updateState(rows, user, input.conversation, (state) => {
        if (input.key === "pin" || input.key === "mute")
          return typeof input.value.v === "boolean"
            ? {
                ...state,
                [input.key]: lwwMerge(state[input.key], {
                  ...input.value,
                  v: input.value.v,
                }),
              }
            : state;
        if (input.key === "retention")
          return input.value.v === "auto" ||
            input.value.v === "week" ||
            input.value.v === "half-year"
            ? {
                ...state,
                retention: lwwMerge(state.retention, {
                  ...input.value,
                  v: input.value.v,
                }),
              }
            : state;
        if (typeof input.value.v !== "string") return state;
        const draft = lwwMerge(state.draft, {
          ...input.value,
          v: input.value.v,
        });
        return {
          ...state,
          draft,
          draftTextId:
            draft !== state.draft ? (input.textId ?? null) : state.draftTextId,
        };
      });
    },
    "chat.state.read": (rows, args, { user }) => {
      const parsed = contract.chat.state.read.args.safeParse(args);
      return parsed.success
        ? updateState(rows, user, parsed.data.conversation, (state) => ({
            ...state,
            readSeq: Math.max(state.readSeq, parsed.data.seq),
          }))
        : rows;
    },
    "chat.announcement.ack": (rows, args, { user }) => {
      const parsed = contract.chat.announcement.ack.args.safeParse(args);
      if (!parsed.success) return rows;
      const previous = rows.find(
        (row) => row.type === "announcementAck" && row.scope === `me:${user}`,
      );
      const revision = Math.max(
        parsed.data.revision,
        (previous?.data as { revision?: number } | undefined)?.revision ?? 0,
      );
      return [
        ...rows.filter((row) => row !== previous),
        {
          scope: `me:${user}`,
          type: "announcementAck",
          id: "current",
          rev: previous?.rev ?? 0,
          deleted: false,
          data: { id: "current", revision },
        },
      ];
    },
    "chat.post.send": (rows, args, { user, op }) => {
      const parsed = contract.chat.post.send.args.safeParse(args);
      if (!parsed.success) return rows;
      const input = parsed.data;
      if (rows.some((row) => row.type === "post" && row.id === input.id))
        return rows;
      const stateRow = rows.find(
        (row) => row.type === "chatState" && row.id === input.conversation,
      );
      const state = chatStateSchema.safeParse(stateRow?.data);
      const profile = rows.find(
        (row) => row.type === "profile" && row.id === user,
      )?.data as { name?: string } | undefined;
      const text = input.text ?? (input.textId ? "长文待发送" : "贴纸");
      const post: ChatPost = {
        id: input.id,
        conversation: input.conversation,
        seq: (state.success ? state.data.lastSeq : 0) + 1,
        rev: 0,
        author: user,
        authorName: profile?.name ?? "我",
        kind: input.kind,
        preview: text.slice(0, 1000),
        bodyLength: text.length,
        replyTo: input.replyTo ?? null,
        created: ulidTime(op),
        edited: null,
        deletedAt: null,
        sticker: null,
        image: null,
      };
      const updated = updateState(
        rows,
        user,
        input.conversation,
        (current) => ({
          ...current,
          lastSeq: post.seq,
          lastPost: post,
          updated: post.created,
        }),
      );
      return [
        ...updated,
        {
          scope: `conv:${input.conversation}`,
          type: "post",
          id: input.id,
          rev: 0,
          deleted: false,
          data: { ...post, pending: op },
        },
      ];
    },
  },
  repositories: {
    rows: (rows) =>
      rows.filter((row) =>
        [
          "communityConversation",
          "communityMember",
          "communitySelf",
          "post",
          "chatState",
          "announcement",
          "announcementAck",
        ].includes(row.type),
      ),
  },
});
export function conversations(
  rows: readonly StoredRow[],
): CommunityConversation[] {
  return rows
    .filter((row) => row.type === "communityConversation" && !row.deleted)
    .map((row) => communityConversationSchema.parse(row.data));
}
export function states(rows: readonly StoredRow[]): ChatState[] {
  return rows
    .filter((row) => row.type === "chatState" && !row.deleted)
    .map((row) => chatStateSchema.parse(row.data));
}
export function members(
  rows: readonly StoredRow[],
  conversation: string,
): CommunityMember[] {
  return rows
    .filter(
      (row) =>
        row.type === "communityMember" &&
        row.scope === `conv:${conversation}` &&
        !row.deleted,
    )
    .map((row) => communityMemberSchema.parse(row.data));
}
export interface PostView extends ChatPost {
  pending?: string;
  failed?: string;
}
export function posts(
  rows: readonly StoredRow[],
  conversation: string,
): PostView[] {
  return rows
    .filter(
      (row) =>
        row.type === "post" &&
        row.scope === `conv:${conversation}` &&
        (!row.deleted || postSchema.safeParse(row.data).success),
    )
    .map((row) => row.data as PostView)
    .sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
}
export function sortedConversations(
  groups: readonly CommunityConversation[],
  values: readonly ChatState[],
): CommunityConversation[] {
  const map = new Map(values.map((value) => [value.conversation, value]));
  return [...groups].sort(
    (a, b) =>
      Number(map.get(b.id)?.pin.v ?? false) -
        Number(map.get(a.id)?.pin.v ?? false) ||
      (map.get(b.id)?.updated ?? b.created) -
        (map.get(a.id)?.updated ?? a.created) ||
      a.name.localeCompare(b.name, "zh-CN"),
  );
}
export function unreadCount(values: readonly ChatState[]): number {
  return values.reduce(
    (sum, state) =>
      sum + (state.mute.v ? 0 : Math.max(0, state.lastSeq - state.readSeq)),
    0,
  );
}
