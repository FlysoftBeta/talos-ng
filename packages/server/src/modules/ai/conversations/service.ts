import { AppError, utf8Encode } from "@talos/base";
import type {
  AiConversation,
  AiDraft,
  AiMessage,
  ArgsOf,
  ai,
} from "@talos/contract";
import { lwwMerge } from "@talos/sync";
import type { WriteContext } from "../../../kernel/persistence/uow.ts";
import type { SyncHub } from "../../../kernel/sync/sync-hub.ts";
import type { AiOptions } from "../options.ts";
import type { AiRepo } from "../repo.ts";
import { messagePreview } from "../repo.ts";
export interface ConversationsContext {
  options: Pick<AiOptions, "uow" | "now" | "allowed">;
  repo: Pick<
    AiRepo,
    | "text"
    | "putText"
    | "message"
    | "file"
    | "conversation"
    | "put"
    | "get"
    | "messages"
    | "putMessage"
    | "rows"
    | "conversations"
    | "messageRows"
  >;
  id: () => string;
}
export class Conversations {
  constructor(private readonly context: ConversationsContext) {}
  putText(
    user: string,
    a: { id: string; offset: number; total: number; text: string },
  ): { ok: true } {
    return this.context.options.uow.write(() => {
      const old = this.context.repo.text(user, a.id);
      if (
        a.offset !== (old?.content.length ?? 0) ||
        (old && old.total !== a.total) ||
        a.offset + a.text.length > a.total
      )
        throw new AppError("E_CONFLICT", "文本分块顺序无效");
      this.context.repo.putText(
        user,
        a.id,
        a.total,
        (old?.content ?? "") + a.text,
        this.context.options.now(),
      );
      return { ok: true };
    });
  }
  content(
    user: string,
    kind: "message" | "draft" | "file",
    id: string,
    offset: number,
  ): { data: { size: number; eof: boolean }; body: Uint8Array } {
    let bytes: Uint8Array;
    if (kind === "message") {
      const m = this.context.repo.message(id);
      if (!m) throw new AppError("E_NOT_FOUND", "消息不存在");
      this.requireConversation(user, m.conversation);
      bytes = utf8Encode(m.text);
    } else if (kind === "draft") {
      const text = this.context.repo.text(user, id);
      if (!text) throw new AppError("E_NOT_FOUND", "草稿不存在");
      bytes = utf8Encode(text.content);
    } else {
      const f = this.context.repo.file(user, id);
      if (!f) throw new AppError("E_NOT_FOUND", "文件不存在");
      bytes = f.bytes;
    }
    return {
      data: { size: bytes.length, eof: offset + 65536 >= bytes.length },
      body: bytes.subarray(offset, offset + 65536),
    };
  }
  requireConversation(user: string, id: string): AiConversation {
    const c = this.context.repo.conversation(user, id);
    if (!c) throw new AppError("E_NOT_FOUND", "AI 对话不存在");
    return c;
  }
  putConversation(user: string, c: AiConversation, ctx: WriteContext): void {
    this.context.repo.put(user, "aiConversation", c.id, c, ctx.rev);
    ctx.changed(`me:${user}`, "aiConversation", c.id);
  }
  create(user: string, title: string): AiConversation {
    return this.context.options.uow.write((ctx) => {
      const c = {
        id: this.context.id(),
        title,
        tags: [],
        lastSeq: 0,
        readSeq: 0,
        running: null,
        updated: this.context.options.now(),
      };
      this.putConversation(user, c, ctx);
      return c;
    });
  }
  update(
    user: string,
    args: ArgsOf<typeof ai.conversation.update>,
  ): { ok: true } {
    return this.context.options.uow.write((ctx) => {
      this.putConversation(
        user,
        {
          ...this.requireConversation(user, args.id),
          title: args.title,
          tags: args.tags,
        },
        ctx,
      );
      return { ok: true };
    });
  }
  read(user: string, id: string, seq: number): { ok: true } {
    return this.context.options.uow.write((ctx) => {
      const c = this.requireConversation(user, id);
      this.putConversation(
        user,
        { ...c, readSeq: Math.max(c.readSeq, Math.min(seq, c.lastSeq)) },
        ctx,
      );
      return { ok: true };
    });
  }
  draft(user: string, value: AiDraft): { ok: true } {
    if (value.textId) {
      const text = this.context.repo.text(user, value.textId);
      if (!text || text.content.length !== text.total || text.total > 100000)
        throw new AppError("E_CONFLICT", "草稿尚未上传完整");
    }
    return this.context.options.uow.write((ctx) => {
      const old = this.context.repo.get<AiDraft>(user, "aiDraft", value.id);
      const merged = old ? lwwMerge(old.value, value.value) : value.value;
      this.context.repo.put(
        user,
        "aiDraft",
        value.id,
        {
          id: value.id,
          ...(merged === old?.value
            ? old.textId
              ? { textId: old.textId }
              : {}
            : value.textId
              ? { textId: value.textId }
              : {}),
          value: merged,
        },
        ctx.rev,
      );
      ctx.changed(`me:${user}`, "aiDraft", value.id);
      return { ok: true };
    });
  }
  page(
    user: string,
    args: ArgsOf<typeof ai.message.page>,
  ): { messages: AiMessage[]; more: boolean; rev: number } {
    this.requireConversation(user, args.conversation);
    const rev = this.context.options.uow.revision;
    const values = this.context.repo.messages(
      args.conversation,
      args.before,
      args.limit ?? 10,
    );
    const messages: AiMessage[] = [];
    let size = 0;
    for (const value of values.slice().reverse()) {
      const preview = messagePreview(value),
        bytes = utf8Encode(JSON.stringify(preview)).length;
      if (size + bytes > 150000) break;
      messages.unshift(preview);
      size += bytes;
    }
    return { messages, more: !!messages[0] && messages[0].seq > 1, rev };
  }
  fork(user: string, id: string): AiConversation {
    const m = this.context.repo.message(id);
    if (!m) throw new AppError("E_NOT_FOUND", "消息不存在");
    const source = this.requireConversation(user, m.conversation);
    if (["running", "queued"].includes(m.status))
      throw new AppError("E_BUSY", "生成中的消息不能创建分支");
    return this.context.options.uow.write((ctx) => {
      const c = this.create(user, `${source.title.slice(0, 110)} · 分支`);
      for (const old of this.context.repo.messages(
        source.id,
        m.seq + 1,
        100000,
      )) {
        const next = {
          ...old,
          id: this.context.id(),
          conversation: c.id,
          rev: ctx.rev,
        };
        this.context.repo.putMessage(user, next);
        ctx.changed(`ai:${c.id}`, "aiMessage", next.id);
      }
      c.lastSeq = m.seq;
      c.readSeq = m.seq;
      c.tags = source.tags;
      this.putConversation(user, c, ctx);
      return c;
    });
  }
  registerSync(hub: SyncHub): void {
    hub.registerProvider({
      match: (s) => s.startsWith("me:"),
      access: (u, s) => s === `me:${u}`,
      list: (u) => [`me:${u}`],
      select: (s, since, limit) =>
        this.context.repo.rows(s.slice(3), since, limit),
    });
    for (const type of ["aiConversation", "aiDraft", "aiCredit"])
      hub.registerEntity(type, {
        accessNeutral: type !== "aiConversation",
        serialize: (r) => r,
        read: (scope, id) =>
          this.context.repo
            .rows(scope.slice(3), -1, 100000)
            .find((r) => r.type === type && r.id === id),
      });
    hub.registerProvider({
      match: (s) => s.startsWith("ai:"),
      access: (u, s) =>
        !!this.context.repo.conversation(u, s.slice(3)) &&
        (!this.context.options.allowed || this.context.options.allowed(u)),
      list: (u) =>
        !this.context.options.allowed || this.context.options.allowed(u)
          ? this.context.repo.conversations(u).map((c) => `ai:${c.id}`)
          : [],
      select: (s, since, limit) =>
        this.context.repo.messageRows(s.slice(3), since, limit),
    });
    hub.registerEntity("aiMessage", {
      windowed: true,
      accessNeutral: true,
      serialize: (r) => r,
      read: (scope, id) => {
        const m = this.context.repo.message(id);
        return m && scope === `ai:${m.conversation}`
          ? {
              type: "aiMessage",
              id,
              rev: m.rev,
              deleted: false,
              data: messagePreview(m),
            }
          : undefined;
      },
    });
  }
}
