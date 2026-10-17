import { AppError } from "@talos/base";
import { contract } from "@talos/contract";
import type {
  ChatState,
  CommunityConversation,
  ChatPost,
  ResultOf,
} from "@talos/contract";
import { ArraySource, Scroller } from "@talos/virtual";
import type { Seek } from "@talos/virtual";
import type { StoredRow } from "../../../core/data/db.ts";
import { StateStore } from "../../../core/controller-state.ts";
import type { ConversationPort } from "./ports.ts";
import {
  fullBody,
  message,
  onlineCall,
  page,
  setState,
  textSource,
  postRow,
} from "./commands.ts";
import { members, posts } from "./module.ts";
import type { PostView } from "./module.ts";
import { historyRows, locateRow, sameRow } from "./history.ts";
import type { HistoryKey, HistoryRow } from "./history.ts";
export interface ConversationInput {
  group: CommunityConversation;
  state: ChatState;
  rows: readonly StoredRow[];
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
  /** The history is finding where to open (or a jump target). */
  seeking: boolean;
  read: number;
}
type PageResult = ResultOf<typeof contract.chat.post.page>;
/**
 * One open conversation. `history` scrolls its posts: it opens at the first unread post
 * (or the newest), pages older and newer posts from the server at its ends, finds reply
 * targets by paging back, and follows new posts while the reader is at the end.
 */
export class ConversationController extends StateStore<ConversationState> {
  readonly initial: number;
  readonly history: Scroller<HistoryRow, HistoryKey>;
  private readonly rows: ArraySource<HistoryRow, HistoryKey>;
  /** Posts fetched from the server that the repository projection may not show yet. */
  private readonly fetched = new Map<string, ChatPost>();
  /** No posts exist below this sequence number. */
  private floor = 0;
  private started = false;
  private generation = 0;
  private textGeneration = 0;
  private canRead: boolean | undefined;
  /** Holes being or already backfilled automatically; a failure leaves the manual action. */
  private readonly repaired = new Set<string>();
  private readonly stops: Array<() => void>;
  constructor(
    private runtime: ConversationPort,
    private input: ConversationInput,
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
      seeking: false,
      read: input.state.readSeq,
    });
    this.initial = input.state.readSeq;
    this.rows = new ArraySource<HistoryRow, HistoryKey>({
      key: (row) => row.id,
      equals: sameRow,
      locate: locateRow,
      load: (direction) => this.extend(direction),
      prepare: (seek) => this.prepare(seek),
    });
    this.history = new Scroller<HistoryRow, HistoryKey>(this.rows, {
      estimate: 64,
      overscan: 480,
      stickToEnd: true,
      endThreshold: 48,
    });
    this.stops = [
      this.history.observe(this.visibleRead),
      this.history.subscribe(() => {
        const seeking = this.history.getSnapshot().status === "seeking";
        if (seeking !== this.state.seeking) this.patch({ seeking });
        this.visibleRead();
      }),
    ];
  }
  bind(input: ConversationInput): void {
    this.input = input;
  }
  private base(): PostView[] {
    const local = posts(this.input.rows, this.input.group.id);
    if (!this.fetched.size) return local;
    const ids = new Set(local.map((post) => post.id));
    const extra = Array.from(this.fetched.values()).filter(
      (post) => !ids.has(post.id),
    );
    return extra.length
      ? [...local, ...extra].sort(
          (a, b) => a.seq - b.seq || a.id.localeCompare(b.id),
        )
      : local;
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
  /** Hands the current rows, and whether the server holds more beyond them, to the history. */
  private sync(): void {
    const base = this.base();
    const first = base[0];
    const last = base[base.length - 1];
    this.rows.set(
      historyRows(this.items(), this.initial, this.runtime.time()),
      {
        before: !!first && first.seq > 1 && first.seq > this.floor,
        after: (last?.seq ?? 0) < this.input.state.lastSeq,
      },
    );
  }
  private online(): boolean {
    return this.runtime.can(contract.chat.post.page).ok;
  }
  private async fetch(
    direction: "before" | "after" | "around" | "latest",
    anchor?: number,
  ): Promise<PageResult> {
    const result = await page(
      this.runtime,
      this.input.group.id,
      direction,
      anchor,
    );
    result.posts.forEach((post) => this.fetched.set(post.id, post));
    // Re-render now: the repository projection of these posts may come later.
    this.patch({});
    if (direction !== "after" && !result.hasBefore)
      this.floor = Math.max(
        this.floor,
        result.posts[0]?.seq ?? (direction === "before" ? (anchor ?? 0) : 0),
      );
    this.sync();
    return result;
  }
  /** The history reached the end of the loaded posts while the server has more. */
  private async extend(direction: "before" | "after"): Promise<void> {
    if (!this.online())
      throw new AppError("E_OFFLINE", "这段历史没有保存在本机，联网后可加载");
    const base = this.base();
    await this.fetch(
      direction,
      direction === "before" ? base[0]?.seq : base[base.length - 1]?.seq,
    );
  }
  /** Fetches what a seek lands on when it is not loaded yet. */
  private async prepare(seek: Seek<HistoryKey>): Promise<void> {
    if (!this.online()) return;
    try {
      await this.prepareOnline(seek);
    } catch (error) {
      // Connectivity can disappear while opening. Complete the seek from local rows;
      // an uncached end supplies its offline reason when the scroller reaches it.
      if (this.online()) throw error;
    }
  }
  private async prepareOnline(seek: Seek<HistoryKey>): Promise<void> {
    const base = this.base();
    if ("edge" in seek) {
      if (seek.edge !== "end") return;
      await this.runtime.sync();
      if ((base[base.length - 1]?.seq ?? 0) < this.input.state.lastSeq)
        await this.fetch("latest");
      return;
    }
    if (!("key" in seek)) return;
    const key = seek.key;
    if ("unreadAfter" in key) {
      await this.runtime.sync();
      if (
        key.unreadAfter < this.input.state.lastSeq &&
        !base.some((post) => post.seq === key.unreadAfter + 1)
      )
        await this.fetch("around", key.unreadAfter + 1);
      return;
    }
    // A reply target outside the loaded posts: page back from the reply across gaps.
    let anchor = key.before;
    while (anchor > 1 && !this.base().some((post) => post.id === key.post)) {
      const result = await this.fetch("before", anchor);
      if (!result.hasBefore || result.first >= anchor || result.first === 0)
        return;
      anchor = result.first;
    }
  }
  update(input: ConversationInput): void {
    this.input = input;
    const can = this.online();
    if (can !== this.canRead) {
      const was = this.canRead;
      this.canRead = can;
      // Ends that failed offline may load now.
      if (can && was === false) {
        if (!this.base().length && input.state.lastSeq > 0)
          // An empty offline opening has no failed edge or boundary id to retry.
          void this.history.jump(
            this.initial < input.state.lastSeq
              ? { key: { unreadAfter: this.initial } }
              : { edge: "end" },
          );
        else this.history.retry();
      }
    }
    this.sync();
    if (!this.started) {
      this.started = true;
      void this.history.start(
        this.initial < input.state.lastSeq
          ? { key: { unreadAfter: this.initial }, align: "start" }
          : { edge: "end" },
      );
    }
    this.visibleRead();
    this.patch({});
  }
  dispose = (): void => {
    ++this.generation;
    ++this.textGeneration;
    this.canRead = undefined;
    this.stops.forEach((stop) => stop());
    this.history.dispose();
  };
  load = async (
    direction: "before" | "after" | "around" | "latest",
    anchor?: number,
  ): Promise<void> => {
    const generation = this.generation;
    this.patch({ loading: true, error: "" });
    try {
      await this.fetch(direction, anchor);
    } catch (cause) {
      if (generation === this.generation) this.patch({ error: message(cause) });
    } finally {
      if (generation === this.generation) this.patch({ loading: false });
    }
  };
  /** Marks fully visible posts read and tracks whether the reader left the end. */
  visibleRead = (): void => {
    const view = this.history.getSnapshot();
    if (view.status !== "ready") return;
    const awayFromBottom = !view.atEnd;
    if (awayFromBottom !== this.state.awayFromBottom)
      this.patch({ awayFromBottom });
    const height = this.history.geometry().viewport;
    if (!height) return;
    this.repairGaps();
    const visible = this.history
      .visible()
      .filter(
        (row) =>
          !row.item.post.failed &&
          !row.item.post.pending &&
          row.top >= -1 &&
          row.bottom <= height + 1,
      )
      .map((row) => row.item.post.seq);
    const highest = Math.max(this.state.read, ...visible);
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
  /**
   * Posts the stored coverage does not vouch for (never loaded, evicted, or loaded
   * before changes the replica missed) are fetched as soon as the reader sees them.
   * A hole that closes and opens again is repaired again; a failed repair keeps
   * the manual action.
   */
  private repairGaps(): void {
    if (this.state.loading || !this.online()) return;
    // A visible post shows the gap below it, so that gap counts as visible too.
    const seqs = this.history
      .visible()
      .filter((row) => !row.item.post.pending && !row.item.post.failed)
      .map((row) => [
        row.item.gap?.from ?? row.item.post.seq,
        row.item.post.seq,
      ])
      .reduce<number[]>((all, pair) => all.concat(pair), []);
    if (!seqs.length) return;
    const holes = this.runtime
      .holes(
        `conv:${this.input.group.id}`,
        "post",
        Math.min(...seqs),
        Math.max(...seqs),
      )
      .map(([lo, hi]) => `${lo}:${hi}`);
    for (const key of this.repaired)
      if (!holes.includes(key)) this.repaired.delete(key);
    const hole = holes.find((key) => !this.repaired.has(key));
    if (!hole) return;
    this.repaired.add(hole);
    void this.load("after", Number(hole.split(":")[0]) - 1);
  }
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
    if (this.history.has(id)) {
      await this.history.jump({ id, align: "center" });
      return;
    }
    if (!this.online()) {
      this.patch({ error: "引用的消息离线未缓存，联网后可跳转查看" });
      return;
    }
    const generation = this.generation;
    this.patch({ loading: true, error: "" });
    const result = await this.history.jump({
      key: { post: id, before },
      align: "center",
    });
    if (generation !== this.generation) return;
    this.patch({
      loading: false,
      ...(result === "missing"
        ? { error: "引用的消息已不可用" }
        : result === "failed"
          ? { error: message(this.history.getSnapshot().error) }
          : {}),
    });
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
    await this.history.jump({ edge: "end" });
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
    return this.runtime.loadRows(`conv:${this.input.group.id}`, {
      kind: "rows",
      rows: [postRow(post)],
    });
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
      { group, state } = this.input;
    return {
      ...this.state,
      group,
      state,
      history: this.history,
      empty: !base.length && !this.items().length,
      first: base[0],
      last: base[base.length - 1],
      unreadRemaining: Math.max(0, state.lastSeq - this.state.read) || "",
      deleteLabel: `消息：${this.state.deleting?.preview.slice(0, 32) || "图片或贴纸"}`,
      discardLabel: `丢弃消息：${this.state.discard?.preview.slice(0, 32)}`,

      can: this.runtime.can(contract.chat.post.page),
      retain: this.runtime.gate("offline"),
      cachedMembers: members(this.input.rows, group.id),
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
