import { StateStore } from "../controller-state.ts";
import { pruneHistory, visit } from "./frecency.ts";
import type { Frecency } from "./frecency.ts";

/** What a recorded item is; the key is `<kind>:<id>`. */
export const ACCESS_KINDS = [
  "chat",
  "book",
  "booklist",
  "song",
  "playlist",
] as const;
export type AccessKind = (typeof ACCESS_KINDS)[number];
export const accessKey = (kind: AccessKind, id: string): string =>
  `${kind}:${id}`;
export function parseAccessKey(
  key: string,
): { kind: AccessKind; id: string } | undefined {
  const at = key.indexOf(":"),
    kind = key.slice(0, at) as AccessKind;
  return at > 0 && ACCESS_KINDS.includes(kind) && key.length > at + 1
    ? { kind, id: key.slice(at + 1) }
    : undefined;
}

export type AccessSnapshot = Readonly<Record<string, Frecency>>;
export interface AccessStorage {
  getLocal<T>(key: string): Promise<T | undefined>;
  setLocal<T>(key: string, value: T): Promise<void>;
}
export const ACCESS_STORAGE_KEY = "recent:access";
/** Bound on stored counters; one small JSON document in the per-user kv store. */
export const ACCESS_LIMIT = 300;
const SAVE_DELAY_MS = 2000;

type Compact = Record<string, [number, number]>;

/**
 * Per-user access counters of conversations, books, booklists, songs and
 * playlists. Local only (IndexedDB through the runtime's per-user kv store);
 * writes are coalesced into one debounced save.
 */
export class AccessHistory extends StateStore<{ entries: AccessSnapshot }> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  private loaded: Promise<void> | undefined;
  constructor(
    private storage: AccessStorage,
    private clock: () => number = Date.now,
  ) {
    super({ entries: {} });
  }
  /** Reads the stored counters once; counts recorded before then are kept. */
  load(): Promise<void> {
    this.loaded ??= this.storage
      .getLocal<Compact>(ACCESS_STORAGE_KEY)
      .then((stored) => {
        const entries: Record<string, Frecency> = {};
        for (const [key, value] of Object.entries(stored ?? {}))
          if (
            Array.isArray(value) &&
            Number.isFinite(value[0]) &&
            Number.isFinite(value[1])
          )
            entries[key] = { score: value[0], at: value[1] };
        this.patch({ entries: { ...entries, ...this.state.entries } });
      })
      .catch(() => undefined);
    return this.loaded;
  }
  record(kind: AccessKind, id: string): void {
    if (!id) return;
    const key = accessKey(kind, id),
      now = this.clock(),
      next = visit(this.state.entries[key], now);
    if (next === this.state.entries[key]) return;
    this.patch({
      entries: pruneHistory(
        { ...this.state.entries, [key]: next },
        ACCESS_LIMIT,
        now,
      ),
    });
    this.dirty = true;
    this.timer ??= setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }
  /** Writes pending changes now (also used when the page hides). */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.dirty) return;
    await this.load();
    this.dirty = false;
    const compact: Compact = {};
    for (const [key, e] of Object.entries(this.state.entries))
      compact[key] = [e.score, e.at];
    try {
      await this.storage.setLocal(ACCESS_STORAGE_KEY, compact);
    } catch {
      this.dirty = true;
    }
  }
  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
