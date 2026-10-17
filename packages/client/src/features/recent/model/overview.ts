import { ACCESS_KINDS, accessFrecent } from "../../../core/ranking/index.ts";
import type {
  AccessKind,
  AccessSnapshot,
  UnreadSignal,
} from "../../../core/ranking/index.ts";

export interface RecentEntry {
  kind: AccessKind;
  id: string;
  title: string;
  hint: string;
}
/** Resolves an id to what the item is called now; undefined when it no longer exists. */
export type RecentResolvers = Record<
  AccessKind,
  (id: string) => { title: string; hint: string } | undefined
>;

export const kindLabel: Record<AccessKind, string> = {
  chat: "对话",
  book: "文档",
  booklist: "书单",
  song: "歌曲",
  playlist: "歌单",
};

/**
 * The global recent list: conversations, books, booklists, songs and playlists
 * ranked together by frecency; its length follows the data, not a fixed count.
 */
export function recentOverview(
  access: AccessSnapshot,
  resolvers: RecentResolvers,
  now: number,
  max = 10,
  chatUnread: Readonly<Record<string, UnreadSignal>> = {},
): RecentEntry[] {
  const out: RecentEntry[] = [];
  for (const ref of accessFrecent(
    access,
    ACCESS_KINDS,
    now,
    (kind, id) => !!resolvers[kind](id),
    { max },
    chatUnread,
  )) {
    const found = resolvers[ref.kind](ref.id);
    if (found) out.push({ ...ref, ...found });
  }
  return out;
}
