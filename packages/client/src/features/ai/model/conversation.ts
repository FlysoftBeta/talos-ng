import { ai } from "@talos/contract";
import type { AiConversation, AiCredit, AiMessage } from "@talos/contract";
import { ArraySource, Scroller } from "@talos/virtual";
import { StateStore } from "../../../core/controller-state.ts";
import type { Capability } from "../../../core/lifecycle/snapshot.ts";
import type {
  RuntimeCommandPort,
  RuntimeFilePort,
  RuntimeNavigationPort,
  RuntimeQueryPort,
} from "../../../core/runtime-port.ts";
import {
  call,
  errorText,
  fullText,
  page,
  saveDraft,
  textSource,
  uploadImage,
} from "./commands.ts";
import type { AiImageFiles, AiPickedFile } from "./commands.ts";
import {
  aiRowSource,
  creditOf,
  draftOf,
  findConversation,
  messagesOf,
} from "./rows.ts";
import type { AiRowSource } from "./rows.ts";

/** Runtime capabilities one open conversation needs. */
export type AiConversationPort = Pick<
  RuntimeCommandPort,
  "can" | "command" | "fetchBody" | "operation" | "flush" | "sync"
> &
  Pick<RuntimeFilePort, "getLocal" | "setLocal"> &
  Pick<
    RuntimeQueryPort,
    "repositories" | "getSnapshot" | "subscribe" | "loadRows"
  > &
  Pick<RuntimeNavigationPort, "dispatch">;

/** Maximum number of images attached to one message. */
export const MAX_IMAGES = 4;
/** Distance from the end, in px, within which the transcript follows new text. */
export const FOLLOW_THRESHOLD_PX = 80;

/** `a，b, c` becomes `["a","b","c"]`. */
export function parseTags(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
export function tagsText(tags: readonly string[]): string {
  return tags.join("，");
}
export function messageStatusLabel(status: AiMessage["status"]): string {
  return status === "running" || status === "queued"
    ? "正在生成…"
    : status === "cancelled"
      ? "已停止"
      : status === "failed"
        ? "生成失败"
        : "";
}
export function messageAuthor(role: AiMessage["role"]): string {
  return role === "user" ? "你" : "AI 助手";
}
export function messageInFlight(status: AiMessage["status"]): boolean {
  return status === "queued" || status === "running";
}
export function imageName(path: string): string {
  return path.split("/").pop() ?? path;
}
/** Why the composer cannot send, or an empty string when sending is allowed. */
export function composerReason(input: {
  send: Capability;
  busy: boolean;
  running: boolean;
  credit: AiCredit | undefined;
  text: string;
}): string {
  if (!input.send.ok) return input.send.reason;
  if (input.busy) return "正在提交，请稍候";
  if (input.running) return "当前对话正在生成";
  if (!input.credit || !input.credit.configured) return "AI 尚未配置";
  if (input.credit.available < input.credit.required)
    return "额度不足，请联系功能管理员充值";
  if (!input.text.trim()) return "请输入文字，图片不能单独发送";
  return "";
}

export interface ConversationState {
  conversation: AiConversation | undefined;
  messages: AiMessage[];
  text: string;
  images: string[];
  /** Object URLs for the picked images, by uploaded workspace path. */
  previews: Record<string, string>;
  busy: boolean;
  error: string;
  /** An older page of messages exists on the server. */
  more: boolean;
  send: Capability;
  stop: Capability;
  draft: Capability;
  /** Empty when sending is allowed. */
  reason: string;
  canAddImage: boolean;
}

const sameMessage = (a: AiMessage, b: AiMessage): boolean =>
  a.rev === b.rev &&
  a.status === b.status &&
  a.text === b.text &&
  a.error === b.error;

/**
 * One open conversation: durable draft text, picked images, message paging,
 * read cursor, run start/stop and forking. `attach()` starts the runtime
 * subscriptions and `detach()` releases them and the preview URLs.
 * `transcript` scrolls the messages: it opens at the end, follows a growing answer
 * while the reader is at the end, and pages earlier messages in at the top.
 */
export class ConversationController<
  F extends AiPickedFile = AiPickedFile,
> extends StateStore<ConversationState> {
  private readonly rows: AiRowSource;
  private cleanups: Array<() => void> = [];
  private attached = false;
  private disposed = false;
  private edited = false;
  private saving: Promise<void> = Promise.resolve();
  private cachedRows: unknown;
  private seenDraft: string | undefined;
  private seenSend: boolean | undefined;
  private seenRead: string | undefined;
  private readonly messages: ArraySource<AiMessage>;
  readonly transcript: Scroller<AiMessage>;
  constructor(
    private readonly port: AiConversationPort,
    readonly id: string,
    private readonly files: AiImageFiles<F>,
  ) {
    super({
      conversation: undefined,
      messages: [],
      text: "",
      images: [],
      previews: {},
      busy: false,
      error: "",
      more: false,
      send: { ok: true },
      stop: { ok: true },
      draft: { ok: true },
      reason: "",
      canAddImage: false,
    });
    this.rows = aiRowSource(port);
    this.messages = new ArraySource<AiMessage>({
      key: (m) => m.id,
      equals: sameMessage,
      load: () => this.earlier(),
    });
    this.transcript = new Scroller<AiMessage>(this.messages, {
      estimate: 120,
      overscan: 800,
      stickToEnd: true,
      endThreshold: FOLLOW_THRESHOLD_PX,
    });
    const draft = draftOf(this.rows.getSnapshot(), id);
    this.state = { ...this.state, text: draft ? draft.value.v : "" };
    this.refresh();
  }
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    void this.port.getLocal<string[]>(`ai:images:${this.id}`).then((v) => {
      if (v && !this.disposed) this.set({ images: v });
    });
    this.cleanups = [
      this.port.subscribe(() => this.refresh()),
      this.rows.subscribe(() => this.refresh()),
    ];
    this.refresh();
    void this.transcript.start({ edge: "end" });
  }
  detach(): void {
    this.attached = false;
    this.disposed = true;
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.transcript.dispose();
    Object.values(this.state.previews).forEach((url) => this.files.revoke(url));
  }
  setText = (value: string): void => {
    this.edited = true;
    this.set({ text: value });
    this.saving = this.saving
      .then(() => saveDraft(this.port, this.id, value))
      .catch((e) => this.fail(e));
  };
  removeImage = (index: number): void =>
    this.setImages(this.state.images.filter((_, n) => n !== index));
  addImage = (file: F | undefined): void => {
    if (!file) return;
    this.set({ busy: true });
    const preview = this.files.preview(file);
    void uploadImage(this.port, this.files, file)
      .then((path) => {
        this.set({ previews: { ...this.state.previews, [path]: preview } });
        this.setImages([...this.state.images, path]);
      })
      .catch((e) => {
        this.files.revoke(preview);
        this.fail(e);
      })
      .finally(() => this.set({ busy: false }));
  };
  send = async (): Promise<void> => {
    if (this.state.reason) return;
    this.set({ busy: true, error: "" });
    try {
      await this.saving;
      const source = await textSource(this.port, this.state.text);
      await this.port.flush();
      await call(this.port, ai.run.start, {
        conversation: this.id,
        ...source,
        images: this.state.images,
      });
      this.setText("");
      this.setImages([]);
      await this.port.sync();
      await page(this.port, this.id);
    } catch (e) {
      this.fail(e);
    } finally {
      this.set({ busy: false });
    }
  };
  stop = (): void => {
    const run = this.state.conversation?.running;
    if (!run) return;
    void call(this.port, ai.run.stop, { id: run }).catch((e) => this.fail(e));
  };
  /** The transcript reached the first loaded message while older ones exist. */
  private async earlier(): Promise<void> {
    const more = await page(this.port, this.id, this.state.messages[0]?.seq);
    this.set({ more, messages: messagesOf(this.rows.getSnapshot(), this.id) });
  }
  fork = (message: string): void => {
    void call(this.port, ai.conversation.fork, { message })
      .then(async (next) => {
        await this.port.sync();
        this.port.dispatch({
          type: "pushPage",
          area: "ai",
          page: { kind: "page", id: next.id },
        });
      })
      .catch((e) => this.fail(e));
  };
  /** Resolves to true when the details were saved. */
  saveDetails = async (title: string, tags: string): Promise<boolean> => {
    try {
      await call(this.port, ai.conversation.update, {
        id: this.id,
        title,
        tags: parseTags(tags),
      });
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  };
  private setImages(values: string[]): void {
    const previews = { ...this.state.previews };
    Object.keys(previews).forEach((path) => {
      if (!values.includes(path)) {
        this.files.revoke(previews[path]!);
        delete previews[path];
      }
    });
    this.set({ images: values, previews });
    void this.port
      .setLocal(`ai:images:${this.id}`, values)
      .catch((e) => this.fail(e));
  }
  private fail(error: unknown): void {
    if (!this.disposed) this.set({ error: errorText(error) });
  }
  private set(value: Partial<ConversationState>): void {
    if (this.disposed) return;
    const next = { ...this.state, ...value };
    if (value.messages || value.more !== undefined)
      this.messages.set(next.messages, { before: next.more });
    this.patch({
      ...value,
      reason: composerReason({
        send: next.send,
        busy: next.busy,
        running: !!next.conversation?.running,
        credit: creditOf(this.rows.getSnapshot()),
        text: next.text,
      }),
      canAddImage:
        next.send.ok && !next.busy && next.images.length < MAX_IMAGES,
    });
  }
  /** Re-derive everything computed from rows and capabilities, then run the change-triggered effects. */
  private refresh(): void {
    if (this.disposed) return;
    const rows = this.rows.getSnapshot(),
      send = this.port.can(ai.run.start),
      conversation = findConversation(rows, this.id),
      draft = draftOf(rows, this.id);
    const derived: Partial<ConversationState> = {
      send,
      stop: this.port.can(ai.run.stop),
      draft: this.port.can(ai.draft.set),
      conversation,
    };
    if (rows !== this.cachedRows) {
      this.cachedRows = rows;
      derived.messages = messagesOf(rows, this.id);
    }
    this.set(derived);
    if (!this.attached) return;
    const draftValue = draft ? draft.value.v : "";
    if (draftValue !== this.seenDraft) {
      this.seenDraft = draftValue;
      if (!this.edited && draft) {
        this.set({ text: draft.value.v });
        if (draft.textId)
          void fullText(this.port, draft.textId, 0, "draft").then((v) => {
            if (v !== undefined && !this.edited) this.set({ text: v });
          });
      }
    }
    if (send.ok !== this.seenSend) {
      this.seenSend = send.ok;
      if (send.ok) {
        void page(this.port, this.id)
          .then((more) => this.set({ more, error: "" }))
          .catch((e) => this.fail(e));
        void call(this.port, ai.account.get, {}).catch((e) => this.fail(e));
      }
    }
    if (conversation) {
      const key = `${conversation.lastSeq}:${conversation.running ?? ""}`;
      if (key !== this.seenRead) {
        this.seenRead = key;
        if (
          conversation.lastSeq > conversation.readSeq &&
          !conversation.running
        )
          void this.port
            .command(ai.conversation.read, {
              id: this.id,
              seq: conversation.lastSeq,
            })
            .catch((e) => this.fail(e));
      }
    }
  }
}

/** Progressive loading of the full body for a message whose synchronized text was truncated. */
export class MessageTextController extends StateStore<{ text: string }> {
  private token = 0;
  constructor(
    private readonly port: Pick<
      AiConversationPort,
      "can" | "fetchBody" | "getLocal" | "setLocal"
    >,
    message: AiMessage,
  ) {
    super({ text: message.text });
  }
  /** Re-evaluate for the latest message revision or capability. */
  update(m: AiMessage): void {
    const token = ++this.token,
      truncated = (m.textLength ?? m.text.length) > m.text.length;
    this.patch({
      text:
        truncated && this.state.text.startsWith(m.text)
          ? this.state.text
          : m.text,
    });
    if (truncated)
      void fullText(this.port, m.id, m.rev)
        .then((value) => {
          if (token === this.token && value !== undefined)
            this.patch({ text: value });
        })
        .catch(() => undefined);
  }
  cancel(): void {
    this.token++;
  }
}
