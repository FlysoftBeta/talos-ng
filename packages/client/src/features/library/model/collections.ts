import { contract } from "@talos/contract";
import type {
  RuntimeCommandPort,
  RuntimeNavigationPort,
} from "../../../core/runtime-port.ts";
import type { SharingAdapter } from "../../sharing/index.ts";
import { collectionPageId } from "./library-data.ts";

export type CollectionCommandPort = Pick<
  RuntimeCommandPort,
  "command" | "sync"
> &
  Pick<RuntimeNavigationPort, "dispatch">;

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

/** Creates a booklist and opens it; resolves to an error message on failure. */
export async function createCollection(
  port: CollectionCommandPort,
  input: { title: string; group: string },
): Promise<{ error?: string }> {
  try {
    const result = await port.command(contract.library.collection.create, {
      title: input.title,
      group: input.group || undefined,
    });
    if (!("queued" in result))
      port.dispatch({
        type: "pushPage",
        area: "library",
        page: { kind: "page", id: collectionPageId(result.id) },
      });
    return {};
  } catch (e) {
    return { error: messageOf(e, "创建失败") };
  }
}
export const canCreateCollection = (title: string): boolean => !!title.trim();

/** Sharing commands of one booklist, in the shape the grant sheet consumes. */
export function collectionSharing(
  port: Pick<RuntimeCommandPort, "command">,
  collection: string,
): SharingAdapter {
  return {
    principals: async () => {
      const value = await port.command(contract.library.sharing.principals, {});
      return "queued" in value ? [] : value.principals;
    },
    list: async () => {
      const value = await port.command(contract.library.sharing.list, {
        collection,
      });
      return "queued" in value ? { grants: [], canShare: false } : value;
    },
    set: async (value) => {
      await port.command(contract.library.sharing.set, {
        collection,
        principalType: value.principalType,
        principal: value.principal,
        level: value.level,
        delegate: value.delegate,
      });
    },
  };
}

/** Order edits are expressed as the complete new document list. */
export function moveDocument(
  docs: readonly string[],
  index: number,
  direction: -1 | 1,
): string[] {
  const next = docs.slice(),
    other = index + direction;
  if (other < 0 || other >= next.length) return next;
  [next[index], next[other]] = [next[other]!, next[index]!];
  return next;
}
export const withoutDocument = (
  docs: readonly string[],
  id: string,
): string[] => docs.filter((value) => value !== id);
export interface CollectionEditorState {
  busy: boolean;
  error: string;
}
/** Serialised edits of one booklist: one mutation at a time, error surfaced as state. */
export class CollectionEditor {
  private state: CollectionEditorState = { busy: false, error: "" };
  private readonly listeners = new Set<() => void>();
  constructor(
    private readonly port: CollectionCommandPort,
    private readonly collection: string,
  ) {}
  getState = (): CollectionEditorState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<CollectionEditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of Array.from(this.listeners)) listener();
  }
  /** Stores the new document list and syncs; resolves true when it succeeded. */
  async save(docs: string[]): Promise<boolean> {
    if (this.state.busy) return false;
    this.set({ busy: true });
    try {
      await this.port.command(contract.library.collection.items, {
        collection: this.collection,
        docs,
      });
      await this.port.sync();
      this.set({ busy: false, error: "" });
      return true;
    } catch (e) {
      this.set({ busy: false, error: messageOf(e, "保存失败") });
      return false;
    }
  }
  /** Transfer is initiated at the source and authorized again by the server. */
  async transfer(doc: string, target: string): Promise<boolean> {
    if (this.state.busy) return false;
    this.set({ busy: true, error: "" });
    try {
      await this.port.command(contract.library.collection.transfer, {
        source: this.collection,
        target,
        doc,
      });
      await this.port.sync();
      this.set({ busy: false });
      return true;
    } catch (error) {
      this.set({ busy: false, error: messageOf(error, "转存失败") });
      return false;
    }
  }
  /** Deletes the booklist and leaves its page; resolves false (with an error) on failure. */
  async remove(): Promise<boolean> {
    try {
      await this.port.command(contract.library.collection.delete, {
        collection: this.collection,
      });
      this.port.dispatch({ type: "back" });
      return true;
    } catch (e) {
      this.set({ error: messageOf(e, "删除失败") });
      return false;
    }
  }
}
