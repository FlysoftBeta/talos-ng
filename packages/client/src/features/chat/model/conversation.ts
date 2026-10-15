import { contract } from "@talos/contract";
import type {
  ChatState,
  CommunityConversation,
  ChatPost,
} from "@talos/contract";
import type { StoredRow } from "../../../core/data/db.ts";
import { StateStore } from "../../../core/controller-state.ts";
import type { ConversationPort } from "./ports.ts";
import {
  fullBody,
  loadReply,
  message,
  onlineCall,
  page,
  setState,
  textSource,
} from "./commands.ts";
import { members, posts } from "./module.ts";
import type { PostView } from "./module.ts";
import { chatDay, dateLabel } from "./format.ts";
export interface ConversationInput {
  group: CommunityConversation;
  state: ChatState;
  rows: readonly StoredRow[];
}
export interface ViewportFacts {
  top: number;
  bottom: number;
  visibleSequences: number[];
}
export interface ConversationViewport {
  scroll(id: string, align: "start" | "end" | "center"): void;
  afterLayout(callback: () => void): void;
  read(): ViewportFacts | undefined;
}
interface ConversationState {
  error: string;
  loading: boolean;
  reply: PostView | undefined;
  settings: boolean;
  showMembers: boolean;
  discover: boolean;
  deleting: PostView | undefined;
  discard: PostView | undefined;
  original: ChatPost | undefined;
  textView: { post: ChatPost; body: string; edit: boolean } | undefined;
  textLoading: boolean;
  selectedPost: string | undefined;
  awayFromBottom: boolean;
  read: number;
}
export class ConversationController extends StateStore<ConversationState> {
  readonly initial: number;
  private initialized = false;
  private generation = 0;
  private textGeneration = 0;
  private canRead: boolean | undefined;
  private lastSeq = -1;
  constructor(
    private runtime: ConversationPort,
    private input: ConversationInput,
    private viewport: ConversationViewport,
  ) {
    super({
      error: "",
      loading: false,
      reply: undefined,
      settings: false,
      showMembers: false,
      discover: false,
      deleting: undefined,
      discard: undefined,
      original: undefined,
      textView: undefined,
      textLoading: false,
      selectedPost: undefined,
      awayFromBottom: false,
      read: input.state.readSeq,
    });
    this.initial = input.state.readSeq;
  }
  bind(input: ConversationInput): void {
    this.input = input;
  }
  private base(): PostView[] {
    return posts(this.input.rows, this.input.group.id);
  }
  private items(): PostView[] {
    const { group, state } = this.input;
    const failed = this.runtime
      .outbox()
      .filter((op) => op.method === "chat.post.send" && op.state === "failed")
      .map((op) => ({ op, args: contract.chat.post.send.args.parse(op.args) }))
      .filter((value) => value.args.conversation === group.id);
    return [
      // Repository projection and outbox notifications can arrive separately.
      // A failed send replaces its pending projection rather than duplicating its key.
      ...this.base().filter(
        (post) => !failed.some((value) => value.args.id === post.id),
      ),
      ...failed.map(({ op, args }, i) => ({
        id: args.id,
        conversation: group.id,
        seq: state.lastSeq + i + 1,
        rev: 0,
        author: this.runtime.getSnapshot().user!.id,
        authorName: "我",
        kind: args.kind,
        preview: args.text?.slice(0, 1000) ?? "长文或贴纸发送失败",
        bodyLength: args.text?.length ?? 0,
        replyTo: args.replyTo ?? null,
        created: op.createdAt,
        edited: null,
        deletedAt: null,
        sticker: null,
        image: null,
        failed: op.op,
      })),
    ];
  }
  update(input: ConversationInput): void {
    this.input = input;
    const can = this.runtime.can(contract.chat.post.page).ok;
    if (can !== this.canRead) {
      this.canRead = can;
      ++this.generation;
      if (can) void this.initialize();
    }
    const items = this.items();
    if (!can && !this.initialized && items.length) {
      this.initialized = true;
      const first = items.find((item) => item.seq > this.initial);
      this.viewport.scroll(
        (first ?? items[items.length - 1]!).id,
        first ? "start" : "end",
      );
    }
    if (input.state.lastSeq !== this.lastSeq) {
      this.lastSeq = input.state.lastSeq;
      if (
        this.initialized &&
        can &&
        this.lastSeq > 0 &&
        !this.base().some((post) => post.seq === this.lastSeq)
      )
        void this.load("latest");
    }
    this.visibleRead();
    this.patch({});
  }
  dispose = (): void => {
    ++this.generation;
    ++this.textGeneration;
    this.canRead = undefined;
  };
  private async initialize(): Promise<void> {
    const generation = this.generation;
    this.initialized = false;
    this.patch({ loading: true });
    try {
      await this.runtime.sync();
      if (generation !== this.generation) return;
      const unread = this.initial < this.input.state.lastSeq;
      const result = await page(
        this.runtime,
        this.input.group.id,
        unread ? "around" : "latest",
        unread ? this.initial + 1 : undefined,
      );
      if (generation !== this.generation) return;
      if (unread && result.hasAfter)
        await page(this.runtime, this.input.group.id, "latest");
      if (generation !== this.generation) return;
      const target =
        result.posts.find((post) => post.seq > this.initial) ??
        result.posts[result.posts.length - 1];
      this.viewport.afterLayout(() => {
        if (generation !== this.generation) return;
        if (target) this.viewport.scroll(target.id, unread ? "start" : "end");
        this.initialized = true;
        this.visibleRead();
      });
    } catch (cause) {
      if (generation === this.generation) this.patch({ error: message(cause) });
    } finally {
      if (generation === this.generation) this.patch({ loading: false });
    }
  }
  load = async (
    direction: "before" | "after" | "around" | "latest",
    anchor?: number,
  ): Promise<string | undefined> => {
    const generation = this.generation;
    this.patch({ loading: true, error: "" });
    try {
      const result = await page(
        this.runtime,
        this.input.group.id,
        direction,
        anchor,
      );
      return generation === this.generation
        ? result.posts[result.posts.length - 1]?.id
        : undefined;
    } catch (cause) {
      if (generation === this.generation) this.patch({ error: message(cause) });
      return undefined;
    } finally {
      if (generation === this.generation) this.patch({ loading: false });
    }
  };
  visibleRead = (): void => {
    if (!this.initialized) return;
    const facts = this.viewport.read();
    if (!facts) return;
    const highest = Math.max(this.state.read, ...facts.visibleSequences);
    const awayFromBottom = facts.bottom > 48;
    if (awayFromBottom !== this.state.awayFromBottom)
      this.patch({ awayFromBottom });
    if (highest > this.state.read) {
      this.patch({ read: highest });
      void this.runtime
        .command(contract.chat.state.read, {
          conversation: this.input.group.id,
          seq: highest,
        })
        .catch((cause) => this.patch({ error: message(cause) }));
    }
  };
  boundary = (): void => {
    this.visibleRead();
    if (this.state.loading || !this.runtime.can(contract.chat.post.page).ok)
      return;
    const facts = this.viewport.read();
    if (!facts) return;
    const base = this.base(),
      first = base[0],
      last = base[base.length - 1];
    if (facts.top < 80 && first && first.seq > 1)
      void this.load("before", first.seq);
    else if (facts.bottom < 80 && last && last.seq < this.input.state.lastSeq)
      void this.load("after", last.seq);
  };
  view = async (post: ChatPost, edit: boolean): Promise<void> => {
    const generation = ++this.textGeneration;
    this.patch({
      textLoading: true,
      textView: { post, body: "", edit },
      error: "",
    });
    try {
      const body = await fullBody(this.runtime, post);
      if (generation === this.textGeneration)
        this.patch({ textView: { post, body, edit } });
    } catch (cause) {
      if (generation === this.textGeneration)
        this.patch({ error: message(cause) });
    } finally {
      if (generation === this.textGeneration)
        this.patch({ textLoading: false });
    }
  };
  jump = async (id: string, before: number): Promise<void> => {
    if (this.items().some((post) => post.id === id)) {
      this.viewport.scroll(id, "center");
      return;
    }
    if (!this.runtime.can(contract.chat.post.page).ok) {
      this.patch({ error: "引用的消息离线未缓存，联网后可跳转查看" });
      return;
    }
    const generation = this.generation;
    this.patch({ loading: true, error: "" });
    try {
      const target = await loadReply(
        this.runtime,
        this.input.group.id,
        id,
        before,
      );
      if (generation !== this.generation) return;
      if (target)
        this.viewport.afterLayout(() => {
          if (generation === this.generation)
            this.viewport.scroll(id, "center");
        });
      else this.patch({ error: "引用的消息已不可用" });
    } catch (cause) {
      if (generation === this.generation) this.patch({ error: message(cause) });
    } finally {
      if (generation === this.generation) this.patch({ loading: false });
    }
  };
  private async action(run: () => Promise<unknown>): Promise<void> {
    try {
      this.patch({ error: "" });
      await run();
    } catch (cause) {
      this.patch({ error: message(cause) });
    }
  }
  newest = async (): Promise<void> => {
    const generation = this.generation;
    const last = await this.load("latest");
    this.viewport.afterLayout(() => {
      if (last && generation === this.generation)
        this.viewport.scroll(last, "end");
    });
  };
  retry = (post: PostView): Promise<void> =>
    this.action(() => this.runtime.retry(post.failed!));
  togglePin = (): Promise<void> =>
    this.action(() =>
      setState(
        this.runtime,
        this.input.group.id,
        "pin",
        !this.input.state.pin.v,
      ),
    );
  toggleMute = (): Promise<void> =>
    this.action(() =>
      setState(
        this.runtime,
        this.input.group.id,
        "mute",
        !this.input.state.mute.v,
      ),
    );
  retention = (value: string): Promise<void> =>
    this.action(() =>
      setState(this.runtime, this.input.group.id, "retention", value),
    );
  deletePost = (): Promise<void> =>
    this.action(async () => {
      const result = await onlineCall(this.runtime, contract.chat.post.delete, {
        id: this.state.deleting!.id,
      });
      await this.storePost(result.post);
      this.patch({ deleting: undefined });
    });
  discardPost = (): Promise<void> =>
    this.action(async () => {
      await this.runtime.discard(this.state.discard!.failed!);
      this.patch({ discard: undefined });
    });
  saveEdit = (): Promise<void> =>
    this.action(async () => {
      const textView = this.state.textView!;
      const source = await textSource(this.runtime, textView.body);
      if ("textId" in source) await this.runtime.flush();
      const result = await onlineCall(this.runtime, contract.chat.post.edit, {
        id: textView.post.id,
        ...source,
      });
      await this.storePost(result.post);
      this.patch({ textView: undefined });
    });
  private storePost(post: ChatPost): Promise<void> {
    return this.runtime.loadRows(`conv:${this.input.group.id}`, [
      {
        type: "post",
        id: post.id,
        rev: post.rev,
        deleted: post.deletedAt !== null,
        data: post,
      },
    ]);
  }
  setReply = (reply?: PostView): void => this.patch({ reply });
  setSettings = (settings: boolean): void => this.patch({ settings });
  setShowMembers = (showMembers: boolean): void => this.patch({ showMembers });
  setDiscover = (discover: boolean): void => this.patch({ discover });
  setDeleting = (deleting?: PostView): void => this.patch({ deleting });
  setDiscard = (discard?: PostView): void => this.patch({ discard });
  setOriginal = (original?: ChatPost): void => this.patch({ original });
  setTextView = (textView?: ConversationState["textView"]): void => {
    if (!textView) ++this.textGeneration;
    this.patch({ textView });
  };
  setSelectedPost = (selectedPost?: string): void => {
    // Click capture also sees native checkbox events in sheets. A redundant
    // synchronous publication would reset their checked value before onChange.
    if (selectedPost !== this.state.selectedPost) this.patch({ selectedPost });
  };
  presentation() {
    const base = this.base(),
      items = this.items(),
      { group, state } = this.input;
    return {
      ...this.state,
      group,
      state,
      items,
      first: base[0],
      last: base[base.length - 1],
      initial: this.initial,
      unreadRemaining: Math.max(0, state.lastSeq - this.state.read) || "",
      deleteLabel: `消息：${this.state.deleting?.preview.slice(0, 32) || "图片或贴纸"}`,
      discardLabel: `丢弃消息：${this.state.discard?.preview.slice(0, 32)}`,

      can: this.runtime.can(contract.chat.post.page),
      retain: this.runtime.gate("offline"),
      cachedMembers: members(this.input.rows, group.id),
      labels: items.map((post, index) => ({
        date: dateLabel(post.created, this.runtime.time()),
        separator:
          index === 0 ||
          chatDay(post.created) !== chatDay(items[index - 1]!.created),
        grouped:
          index > 0 &&
          post.author === items[index - 1]!.author &&
          post.created - items[index - 1]!.created <= 300000 &&
          chatDay(post.created) === chatDay(items[index - 1]!.created),
      })),
      load: this.load,
      view: this.view,
      jump: this.jump,
      newest: this.newest,
      retry: this.retry,
      togglePin: this.togglePin,
      toggleMute: this.toggleMute,
      retention: this.retention,
      deletePost: this.deletePost,
      discardPost: this.discardPost,
      saveEdit: this.saveEdit,
      setReply: this.setReply,
      setSettings: this.setSettings,
      setShowMembers: this.setShowMembers,
      setDiscover: this.setDiscover,
      setDeleting: this.setDeleting,
      setDiscard: this.setDiscard,
      setOriginal: this.setOriginal,
      setTextView: this.setTextView,
      setSelectedPost: this.setSelectedPost,
    };
  }
}
