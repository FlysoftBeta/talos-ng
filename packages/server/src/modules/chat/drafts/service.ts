import { AppError } from "@talos/base";
import type { ArgsOf, ChatState } from "@talos/contract";
import {
  chat,
  CHAT_MAX_TEXT,
  chatStateSchema,
  MAX_FUTURE_SKEW_MS,
} from "@talos/contract";
import { clampFutureStamp, lwwMerge, maxMerge } from "@talos/sync";
import type { WriteContext } from "../../../kernel/persistence/uow.ts";
import { initialChatState } from "../drafts/state.ts";
import { textChunk } from "../drafts/text-chunk.ts";
import type { BodyChunk, ChatOptions } from "../options.ts";
import type { ChatRepo } from "../repo.ts";
export interface DraftsContext {
  repo: Pick<
    ChatRepo,
    "putState" | "state" | "latest" | "mutedUntil" | "text" | "putText"
  >;
  options: Pick<ChatOptions, "community" | "uow">;
  now: () => number;
}
export class Drafts {
  constructor(private readonly context: DraftsContext) {}
  membershipChanged(
    user: string,
    conversation: string,
    joined: boolean,
    ctx: WriteContext,
  ): void {
    const state = this.state(user, conversation);
    this.context.repo.putState(user, state, ctx.rev, !joined);
    ctx.changed(`me:${user}`, "chatState", conversation);
  }
  state(user: string, conversation: string): ChatState {
    const current =
      this.context.repo.state(user, conversation) ??
      initialChatState(conversation);
    const latest = this.context.repo.latest(conversation);
    return {
      ...current,
      lastSeq: latest?.seq ?? 0,
      lastPost: latest ?? null,
      updated: latest?.created ?? 0,
      mutedUntil: this.context.repo.mutedUntil(user),
    };
  }
  ensureStates(user: string): void {
    for (const conv of this.context.options.community.conversations(user))
      if (!this.context.repo.state(user, conv.id))
        this.context.options.uow.write((ctx) =>
          this.membershipChanged(user, conv.id, true, ctx),
        );
  }
  /** Refreshes every member's last post; the author has read their own post. */
  touch(conversation: string, ctx: WriteContext, author?: string): void {
    for (const member of this.context.options.community.members(conversation)) {
      const state = this.state(member.user, conversation);
      this.context.repo.putState(
        member.user,
        member.user === author
          ? { ...state, readSeq: maxMerge(state.readSeq, state.lastSeq) }
          : state,
        ctx.rev,
      );
      ctx.changed(`me:${member.user}`, "chatState", conversation);
    }
  }
  putText(
    user: string,
    args: ArgsOf<typeof chat.text.put>,
  ): { offset: number } {
    const parsed = chat.text.put.args.safeParse(args);
    if (!parsed.success) throw new AppError("E_INVALID", "文本分块无效");
    const value = parsed.data;
    return this.context.options.uow.write(() => {
      const previous = this.context.repo.text(value.id);
      if (
        previous &&
        (previous.user !== user || previous.total !== value.total)
      )
        throw new AppError("E_CONFLICT", "文本编号已被使用");
      const body = previous?.body ?? "";
      if (value.offset < body.length) {
        if (
          body.slice(value.offset, value.offset + value.text.length) !==
          value.text
        )
          throw new AppError("E_CONFLICT", "文本分块不一致");
        return { offset: body.length };
      }
      if (
        value.offset !== body.length ||
        body.length + value.text.length > value.total
      )
        throw new AppError("E_CONFLICT", "文本分块顺序不正确");
      this.context.repo.putText({
        id: value.id,
        user,
        total: value.total,
        body: body + value.text,
        updated: this.context.now(),
      });
      return { offset: body.length + value.text.length };
    });
  }
  text(user: string, args: { text?: string; textId?: string }): string {
    let body = args.text;
    if (args.textId) body = this.stagedText(user, args.textId);
    if (body === undefined || !body.trim())
      throw new AppError("E_INVALID", "消息不能为空");
    body = body.trim();
    if (body.length > CHAT_MAX_TEXT)
      throw new AppError("E_TOO_LARGE", "消息不能超过 5,000,000 字符");
    return body;
  }
  stagedText(user: string, id: string): string {
    const row = this.context.repo.text(id);
    if (!row || row.user !== user)
      throw new AppError("E_NOT_FOUND", "文本不存在");
    if (row.body.length !== row.total)
      throw new AppError("E_CONFLICT", "文本上传尚未完成");
    return row.body;
  }
  textBody(user: string, args: ArgsOf<typeof chat.text.fetch>): BodyChunk {
    const text = this.context.repo.text(args.id);
    if (!text || text.user !== user)
      throw new AppError("E_NOT_FOUND", "文本不存在");
    return textChunk(text.body, args);
  }
  setState(
    user: string,
    args: ArgsOf<typeof chat.state.set>,
  ): { state: ChatState } {
    if (!chat.state.set.args.safeParse(args).success)
      throw new AppError("E_INVALID", "对话设置值无效");
    const current = this.state(user, args.conversation);
    const next = {
      ...args.value,
      t: clampFutureStamp(args.value.t, this.context.now(), MAX_FUTURE_SKEW_MS)
        .stamp,
    };
    const merged = lwwMerge<boolean | string>(current[args.key], next);
    if (merged === current[args.key]) return { state: current };
    if (args.textId && args.key !== "draft")
      throw new AppError("E_INVALID", "文本仅可用于草稿");
    if (args.textId) this.stagedText(user, args.textId);
    const candidate = {
      ...current,
      [args.key]: merged,
      ...(args.key === "draft" ? { draftTextId: args.textId ?? null } : {}),
    };
    const parsed = chatStateSchema.safeParse(candidate);
    if (!parsed.success) throw new AppError("E_INVALID", "对话设置值无效");
    return this.context.options.uow.write((ctx) => {
      this.context.repo.putState(user, parsed.data, ctx.rev);
      ctx.changed(`me:${user}`, "chatState", args.conversation);
      return { state: parsed.data };
    });
  }
  read(
    user: string,
    args: ArgsOf<typeof chat.state.read>,
  ): { state: ChatState } {
    const state = this.state(user, args.conversation);
    if (args.seq > state.lastSeq)
      throw new AppError("E_INVALID", "已读位置超过最新消息");
    return this.context.options.uow.write((ctx) => {
      const next = { ...state, readSeq: maxMerge(state.readSeq, args.seq) };
      this.context.repo.putState(user, next, ctx.rev);
      ctx.changed(`me:${user}`, "chatState", args.conversation);
      return { state: next };
    });
  }
}
