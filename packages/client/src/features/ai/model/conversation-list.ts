import { ai } from "@talos/contract";
import type { AiConversation, AiCredit } from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { StoredRow } from "../../../core/data/db.ts";
import type { Capability } from "../../../core/lifecycle/snapshot.ts";
import type {
  RuntimeClockPort,
  RuntimeCommandPort,
  RuntimeNavigationPort,
  RuntimeQueryPort,
} from "../../../core/runtime-port.ts";
import { call, errorText } from "./commands.ts";
import type { AiCallPort } from "./commands.ts";
import {
  aiRowSource,
  conversationsOf,
  creditOf,
  currentConversationId,
} from "./rows.ts";
import type { AiRowSource } from "./rows.ts";

/** Runtime capabilities the conversation list needs. */
export type AiListPort = AiCallPort &
  Pick<RuntimeCommandPort, "can" | "sync"> &
  Pick<RuntimeQueryPort, "repositories" | "getSnapshot" | "subscribe"> &
  Pick<RuntimeNavigationPort, "dispatch"> &
  Pick<RuntimeClockPort, "delay" | "clearDelay">;

/** Search is applied after this pause so typing does not refilter every keystroke. */
export const SEARCH_DEBOUNCE_MS = 350;

export interface ConversationItem {
  id: string;
  title: string;
  hint: string;
  selected: boolean;
  trailing: string | undefined;
}
export interface AiListState {
  query: string;
  search: string;
  error: string;
  can: Capability;
  items: ConversationItem[];
  /** Quota summary line; absent until the credit row has synchronized. */
  creditLine: string | undefined;
  emptyState: "empty" | "offline";
  emptyTitle: string;
}

/** `每日剩余 …% · 每周剩余 …% · 可用 … 额度`. */
export function creditLine(credit: AiCredit): string {
  const left = (total: number, used: number): number =>
    Math.round((100 * Math.max(0, total - used)) / Math.max(1, total));
  return `每日剩余 ${left(credit.daily, credit.dayUsed)}% · 每周剩余 ${left(credit.weekly, credit.weekUsed)}% · 可用 ${(credit.available / 1e6).toFixed(2)} 额度`;
}
export function matchesSearch(c: AiConversation, search: string): boolean {
  return `${c.title} ${c.tags.join(" ")}`.toLocaleLowerCase().includes(search);
}
export function conversationItems(
  rows: readonly StoredRow[],
  search: string,
  currentId: string | undefined,
): ConversationItem[] {
  return conversationsOf(rows)
    .filter((c) => matchesSearch(c, search))
    .map((c) => ({
      id: c.id,
      title: c.title,
      hint: c.running ? "正在生成…" : c.tags.join(" · ") || "继续对话",
      selected: c.id === currentId,
      trailing: c.running ? "●" : c.lastSeq > c.readSeq ? "未读" : undefined,
    }));
}

/** Conversation list, debounced title/tag search, quota line and conversation creation. */
export class AiListController extends StateStore<AiListState> {
  private readonly rows: AiRowSource;
  private timer: unknown;
  private cleanups: Array<() => void> = [];
  private attached = false;
  constructor(private readonly port: AiListPort) {
    super({
      query: "",
      search: "",
      error: "",
      can: { ok: true },
      items: [],
      creditLine: undefined,
      emptyState: "empty",
      emptyTitle: "暂无 AI 对话",
    });
    this.rows = aiRowSource(port);
    this.refresh();
  }
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.cleanups = [
      this.port.subscribe(() => this.refresh()),
      this.rows.subscribe(() => this.refresh()),
    ];
    this.refresh();
  }
  detach(): void {
    this.attached = false;
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.clearTimer();
  }
  setQuery = (query: string): void => {
    this.clearTimer();
    this.patch({ query });
    this.timer = this.port.delay(() => {
      this.timer = undefined;
      this.patch({ search: query.trim().toLocaleLowerCase() });
      this.refresh();
    }, SEARCH_DEBOUNCE_MS);
  };
  open = (id: string): void => {
    this.port.dispatch({
      type: "pushPage",
      area: "ai",
      page: { kind: "page", id },
    });
  };
  create = (): void => {
    void call(this.port, ai.conversation.create, { title: "新对话" })
      .then((c) => {
        this.open(c.id);
        return this.port.sync();
      })
      .catch((e) => this.patch({ error: errorText(e) }));
  };
  private clearTimer(): void {
    if (this.timer !== undefined) this.port.clearDelay(this.timer);
    this.timer = undefined;
  }
  private refresh(): void {
    const rows = this.rows.getSnapshot(),
      can = this.port.can(ai.conversation.create),
      search = this.state.search,
      currentId = currentConversationId(
        this.port.getSnapshot().nav.areas.ai.stack,
      ),
      items = conversationItems(rows, search, currentId),
      credit = creditOf(rows);
    this.patch({
      can,
      items,
      creditLine: credit ? creditLine(credit) : undefined,
      emptyState: can.ok ? "empty" : "offline",
      emptyTitle: search ? "没有匹配的对话" : "暂无 AI 对话",
    });
  }
}
