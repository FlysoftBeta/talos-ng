import { compareStamp, HybridClock } from "@talos/base";
import { contract } from "@talos/contract";
import type { LibraryDoc, LibraryState } from "@talos/contract";
import type {
  RuntimeClockPort,
  RuntimeCommandPort,
  RuntimeNavigationPort,
} from "../../../core/runtime-port.ts";
import { ReadingClock } from "./clock.ts";
import { openDocument } from "./resources.ts";
import type { DocumentResources, DocumentSessionPort } from "./resources.ts";

export interface ReaderPosition {
  unit: number;
  offset: number;
  unitId?: string;
  charOffset?: number;
  /** Character top relative to the viewport, preserving the within-line position. */
  charInset?: number;
}
export type ReaderPort = DocumentSessionPort &
  Pick<RuntimeCommandPort, "operation"> &
  Pick<RuntimeClockPort, "time" | "delay" | "clearDelay"> &
  Pick<RuntimeNavigationPort, "dispatch" | "navigationGuards">;
/** Whether the page is on screen; an adapter over the browser's visibility events. */
export interface PageVisibility {
  hidden(): boolean;
  subscribe(listener: () => void): () => void;
}
/** Everything the session reads from the outside world; replaced whenever it changes. */
export interface ReaderInput {
  doc: LibraryDoc | undefined;
  state: LibraryState;
  /** The account may read this kind of document. */
  readable: boolean;
  /** The server is reachable for opening documents. */
  canOpen: boolean;
  device: string | undefined;
  /** The application is unlocked and not concealed. */
  foreground: boolean;
  /** Identity changes whenever the download list changes. */
  downloads: unknown;
}
export interface ReaderState {
  resources: DocumentResources | undefined;
  error: string;
  /** The complete pack is stored on this device. */
  retained: boolean;
}

const BEAT_MS = 15000;
const SAVE_DELAY_MS = 500;
const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export function retentionValue(policy: string): "auto" | 1 | 7 | 180 {
  return policy === "auto" ? "auto" : (Number(policy) as 1 | 7 | 180);
}
export function retentionChoice(
  state: { value?: { v: string | number } | null } | undefined,
): string {
  return String(state?.value?.v ?? "auto");
}
export function retentionStatus(
  retained: boolean,
  downloads: readonly { id: string }[],
  doc: string,
): string {
  return retained
    ? "已保留 · 可完整离线阅读"
    : downloads.some((d) => d.id === `library:${doc}`)
      ? "下载中 · 可在状态中心查看"
      : "尚未下载 · 连接后自动下载完整文档";
}
export interface ReaderDetails {
  title: string;
  author: string;
  imported: string;
  sizeLabel: string;
  size: number;
  furthest: string;
  seconds: number;
}
export function readerDetails(
  doc: LibraryDoc,
  state: LibraryState,
  user: { id: string; name: string } | undefined,
): ReaderDetails {
  return {
    title: doc.title,
    author: doc.owner === user?.id ? user.name : doc.owner,
    imported: new Date(doc.created).toLocaleString("zh-CN"),
    sizeLabel: doc.kind === "paged" ? "页数" : "字数",
    size: doc.kind === "paged" ? doc.units : doc.chars,
    furthest: `${Math.min(doc.units, state.furthest + 1)} / ${doc.units}`,
    seconds: Object.values(state.seconds).reduce((sum, n) => sum + n, 0),
  };
}

/**
 * One open document: loads its resources, accounts visible reading time, and persists
 * resume position, furthest unit and seconds (debounced on movement, on a heartbeat,
 * when hidden, on navigation and on close).
 */
export class ReadingSession {
  private snapshot: ReaderState = {
    resources: undefined,
    error: "",
    retained: false,
  };
  private readonly listeners = new Set<() => void>();
  private position: ReaderPosition;
  private furthest: number;
  private readonly clock: ReadingClock;
  private saveTimer: unknown;
  private retries = 0;
  private loadKey = "";
  private retainedKey: unknown[] | undefined;
  private clockKey: unknown[] | undefined;
  private stopClock: (() => void) | undefined;
  private stopLoad: (() => void) | undefined;
  private stopRetained: (() => void) | undefined;
  private stopGuard: (() => void) | undefined;
  constructor(
    private readonly id: string,
    private readonly port: ReaderPort,
    private readonly visibility: PageVisibility,
    private input: ReaderInput,
  ) {
    this.position = input.state.resume?.v ?? { unit: 0, offset: 0 };
    this.furthest = input.state.furthest;
    this.clock = new ReadingClock(
      () => port.time(),
      input.state.seconds[input.device ?? ""] ?? 0,
    );
  }
  getState = (): ReaderState => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  /** The position the viewer should restore when it mounts. */
  initialPosition(): ReaderPosition {
    return this.position;
  }
  private set(patch: Partial<ReaderState>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of Array.from(this.listeners)) listener();
  }
  /** Registers the navigation guard that flushes progress; pair with dispose(). */
  start(): void {
    this.stopGuard = this.port.navigationGuards.add(() => {
      this.port.clearDelay(this.saveTimer);
      void this.save();
      return true;
    });
  }
  /** Feeds the latest outside state and restarts whatever depends on what changed. */
  update(input: ReaderInput): void {
    this.input = input;
    const { doc } = input;
    const loadKey = [
      doc?.status,
      input.canOpen,
      input.readable,
      this.retries,
    ].join();
    if (loadKey !== this.loadKey) {
      this.loadKey = loadKey;
      this.reload();
    }
    const retained = [doc?.pack?.id, input.downloads];
    if (!sameKey(retained, this.retainedKey)) {
      this.retainedKey = retained;
      this.refreshRetained();
    }
    const clock = [this.snapshot.resources, input.foreground, input.readable];
    if (!sameKey(clock, this.clockKey)) {
      this.clockKey = clock;
      this.restartClock();
    }
  }
  private reload(): void {
    this.stopLoad?.();
    let closed = false;
    this.stopLoad = () => {
      closed = true;
    };
    this.set({ error: "" });
    const { doc, readable } = this.input;
    if (doc?.status === "ready" && readable)
      void openDocument(this.port, this.id)
        .then((value) => {
          if (closed) return;
          this.set({ resources: value });
          this.update(this.input);
        })
        .catch((e) => {
          if (!closed) this.set({ error: messageOf(e, "读取失败") });
        });
  }
  private refreshRetained(): void {
    this.stopRetained?.();
    let closed = false;
    this.stopRetained = () => {
      closed = true;
    };
    const pack = this.input.doc?.pack;
    if (pack)
      void this.port.hasFile(pack.id).then((value) => {
        if (!closed) this.set({ retained: value });
      });
  }
  private restartClock(): void {
    this.stopClock?.();
    const { port, visibility, clock } = this;
    const visible = () => {
      clock.setActive(
        !visibility.hidden() &&
          !!this.snapshot.resources &&
          this.input.foreground &&
          this.input.readable,
      );
      if (visibility.hidden()) void this.save();
    };
    let timer: unknown;
    const beat = () => {
      if (!visibility.hidden()) void this.save();
      timer = port.delay(beat, BEAT_MS);
    };
    visible();
    timer = port.delay(beat, BEAT_MS);
    const unsubscribe = visibility.subscribe(visible);
    this.stopClock = () => {
      clock.setActive(false);
      unsubscribe();
      port.clearDelay(timer);
    };
  }
  /** Re-attempts opening the document after a failure. */
  retry(): void {
    this.retries++;
    this.update(this.input);
  }
  /** The viewer moved; the position is stored shortly after movement settles. */
  positionChanged(value: ReaderPosition): void {
    this.position = value;
    this.port.clearDelay(this.saveTimer);
    this.saveTimer = this.port.delay(() => void this.save(), SAVE_DELAY_MS);
  }
  private async save(): Promise<void> {
    const { doc, readable, state, device } = this.input;
    if (!this.snapshot.resources || !doc || !readable) return;
    try {
      const op = this.port.operation();
      this.furthest = Math.max(this.furthest, this.position.unit);
      await this.port.command(
        contract.library.progress.set,
        {
          doc: this.id,
          resume: { v: this.position, ...op },
          furthest: this.furthest,
          seconds: Math.max(this.clock.seconds(), state.seconds[device!] ?? 0),
          device: device!,
        },
        { op: op.op },
      );
    } catch (e) {
      this.set({ error: messageOf(e, "阅读进度保存失败") });
    }
  }
  async toggleFavourite(): Promise<void> {
    const op = this.port.operation();
    const favourite = !this.input.state.favourite?.v;
    try {
      const previous = this.input.state.favourite?.t;
      const t =
        previous && compareStamp(op.t, previous) <= 0
          ? new HybridClock(() => op.t.ms).observe(previous)
          : op.t;
      await this.port.command(
        contract.library.favourite.set,
        { doc: this.id, value: { v: favourite, ...op, t } },
        { op: op.op },
      );
    } catch (e) {
      this.set({ error: messageOf(e, "收藏失败") });
    }
  }
  /** Stores the offline retention policy; resolves true when it was accepted. */
  async saveRetention(policy: string): Promise<boolean> {
    const op = this.port.operation();
    try {
      await this.port.command(
        contract.library.retention.set,
        {
          kind: "doc",
          id: this.id,
          value: { v: retentionValue(policy), ...op },
        },
        { op: op.op },
      );
      return true;
    } catch (e) {
      this.set({ error: messageOf(e, "保存失败") });
      return false;
    }
  }
  /** Deletes the document and leaves the reader; resolves false (with an error) on failure. */
  async deleteDocument(): Promise<boolean> {
    try {
      await this.port.command(contract.library.doc.delete, { doc: this.id });
      this.port.dispatch({ type: "back" });
      return true;
    } catch (e) {
      this.set({ error: messageOf(e, "删除失败") });
      return false;
    }
  }
  back(): void {
    this.port.dispatch({ type: "back" });
  }
  showTasks(): void {
    this.port.dispatch({ type: "openOverlay", overlay: { kind: "tasks" } });
  }
  /** Stops timers and listeners and flushes the last position. */
  dispose(): void {
    this.stopGuard?.();
    this.stopClock?.();
    this.stopLoad?.();
    this.stopRetained?.();
    this.port.clearDelay(this.saveTimer);
    void this.save();
    this.loadKey = "";
    this.retainedKey = undefined;
    this.clockKey = undefined;
  }
}
const sameKey = (a: unknown[], b: unknown[] | undefined): boolean =>
  !!b && a.length === b.length && a.every((value, i) => value === b[i]);
