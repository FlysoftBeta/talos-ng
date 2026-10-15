import { AppError } from "@talos/base";
import { contract } from "@talos/contract";
import type { Netbook } from "@talos/contract";
import type {
  RuntimeClockPort,
  RuntimeCommandPort,
  RuntimeNavigationPort,
  RuntimeSessionPort,
} from "../../../core/runtime-port.ts";
import { cooldownDeadline, remainingSeconds } from "./cooldown.ts";

export type NetbooksPort = Pick<RuntimeCommandPort, "command" | "can"> &
  Pick<RuntimeSessionPort, "gate"> &
  Pick<RuntimeClockPort, "time" | "delay" | "clearDelay"> &
  Pick<RuntimeNavigationPort, "dispatch">;
export interface NetbooksState {
  query: string;
  /** Destination booklist id, empty until chosen. */
  collection: string;
  /** Search results; null before the first search. */
  books: Netbook[] | null;
  busy: boolean;
  error: string;
  /** Absolute end of the search cooldown (0 when none). */
  deadline: number;
  now: number;
  notice: string;
  /** Book whose download is being submitted. */
  downloading: string | undefined;
  /** Book id to download job id. */
  submitted: Record<string, string>;
}
const TICK_MS = 250;

/** Why searching and downloading are unavailable right now, if they are. */
export function unavailableReason(port: NetbooksPort): {
  reason: string | undefined;
  forbidden: boolean;
} {
  const can = port.can(contract.netbooks.search),
    gate = port.gate("article_download");
  return {
    reason: !can.ok ? can.reason : !gate.ok ? gate.reason : undefined,
    forbidden: !gate.ok && can.ok,
  };
}
export function canSearch(
  state: NetbooksState,
  reason: string | undefined,
): boolean {
  return (
    !state.busy &&
    !!state.query.trim() &&
    !reason &&
    remainingSeconds(state.deadline, state.now) === 0
  );
}

/**
 * Search and download lifecycle of the network-books dialog: one request at a time,
 * a server-driven search cooldown, and updates dropped once the dialog is gone.
 */
export class NetbooksController {
  private state: NetbooksState;
  private readonly listeners = new Set<() => void>();
  private mutation = false;
  private closed = false;
  private ticker: unknown;
  constructor(private readonly port: NetbooksPort) {
    this.state = {
      query: "",
      collection: "",
      books: null,
      busy: false,
      error: "",
      deadline: 0,
      now: port.time(),
      notice: "",
      downloading: undefined,
      submitted: {},
    };
  }
  getState = (): NetbooksState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<NetbooksState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of Array.from(this.listeners)) listener();
  }
  setQuery(query: string): void {
    this.set({ query });
  }
  setCollection(collection: string): void {
    this.set({ collection });
  }
  private startCooldown(wait: number): void {
    const now = this.port.time();
    this.set({ deadline: cooldownDeadline(now, wait, 0), now });
    this.port.clearDelay(this.ticker);
    const tick = () => {
      const current = this.port.time();
      this.set({ now: current });
      this.ticker =
        remainingSeconds(this.state.deadline, current) > 0
          ? this.port.delay(tick, TICK_MS)
          : undefined;
    };
    this.ticker = this.port.delay(tick, TICK_MS);
  }
  /** Searches for the current query; ignored while another request is running. */
  async search(): Promise<void> {
    await this.request(async () => {
      const result = await this.port.command(contract.netbooks.search, {
        query: this.state.query,
      });
      if (!("queued" in result) && !this.closed) {
        this.set({ books: result.books });
        this.startCooldown(result.retryAt - result.serverTime);
      }
    });
  }
  /** Submits a download job for a book into the chosen booklist. */
  async download(book: string): Promise<void> {
    await this.request(async () => {
      this.set({ downloading: book });
      const result = await this.port.command(contract.netbooks.download, {
        book,
        collection: this.state.collection,
      });
      if (!("queued" in result) && !this.closed)
        this.set({
          submitted: { ...this.state.submitted, [book]: result.job },
          notice: result.joined
            ? "已加入正在进行的下载，可在任务中查看进度"
            : "下载已开始，可在任务中查看进度",
        });
    });
  }
  private async request(run: () => Promise<void>): Promise<void> {
    if (this.mutation) return;
    this.mutation = true;
    this.set({ busy: true, error: "" });
    try {
      await run();
    } catch (e) {
      if (!this.closed) {
        this.set({ error: e instanceof Error ? e.message : "请求失败" });
        if (e instanceof AppError && e.code === "E_BUSY") {
          const d = e.data as
            { retryAt?: number; serverTime?: number } | undefined;
          if (d?.retryAt) {
            const now = this.port.time();
            this.startCooldown(d.retryAt - (d.serverTime ?? now));
          }
        }
      }
    } finally {
      this.mutation = false;
      if (!this.closed) this.set({ busy: false, downloading: undefined });
    }
  }
  /** Opens the task list (downloads continue after the dialog closes). */
  showTasks(): void {
    this.port.dispatch({ type: "openOverlay", overlay: { kind: "tasks" } });
  }
  /** Drops later results and stops the cooldown ticker. */
  dispose(): void {
    this.closed = true;
    this.port.clearDelay(this.ticker);
  }
}
