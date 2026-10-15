import type { PostView } from "./module.ts";
import { chatDay, dateLabel } from "./format.ts";

/** One post of the scrolled history with everything it shows from its neighbours. */
export interface HistoryRow {
  readonly id: string;
  readonly post: PostView;
  /** The post it replies to, when that is loaded. */
  readonly reply: PostView | undefined;
  readonly date: string;
  /** First post of its day: shows the date separator. */
  readonly separator: boolean;
  /** Same author within five minutes of the previous post. */
  readonly grouped: boolean;
  /** Sequence numbers missing between the previous loaded post and this one. */
  readonly gap: { readonly from: number; readonly to: number } | undefined;
  /** The first unread post when the conversation was opened. */
  readonly unread: boolean;
}
/** Seek keys: the first post after a read cursor, or a post by id found by paging back from `before`. */
export type HistoryKey =
  | { readonly unreadAfter: number }
  | { readonly post: string; readonly before: number };

export function historyRows(
  items: readonly PostView[],
  initial: number,
  now: number,
): HistoryRow[] {
  const byId = new Map(items.map((post) => [post.id, post]));
  return items.map((post, index) => {
    const previous = items[index - 1];
    const day = chatDay(post.created);
    const sameDay = !!previous && chatDay(previous.created) === day;
    return {
      id: post.id,
      post,
      reply: post.replyTo ? byId.get(post.replyTo) : undefined,
      date: dateLabel(post.created, now),
      separator: !sameDay,
      grouped:
        sameDay &&
        post.author === previous.author &&
        post.created - previous.created <= 300000,
      gap:
        previous && post.seq > previous.seq + 1
          ? { from: previous.seq + 1, to: post.seq - 1 }
          : undefined,
      unread: initial > 0 && post.seq === initial + 1,
    };
  });
}
const samePost = (a: PostView, b: PostView): boolean =>
  a === b ||
  (a.id === b.id &&
    a.rev === b.rev &&
    a.seq === b.seq &&
    a.deletedAt === b.deletedAt &&
    a.edited === b.edited &&
    a.preview === b.preview &&
    a.failed === b.failed &&
    a.pending === b.pending);
/** Whether a row renders the same, so unchanged rows are not re-rendered after a refresh. */
export function sameRow(a: HistoryRow, b: HistoryRow): boolean {
  return (
    samePost(a.post, b.post) &&
    (a.reply === b.reply ||
      (!!a.reply && !!b.reply && samePost(a.reply, b.reply))) &&
    a.date === b.date &&
    a.separator === b.separator &&
    a.grouped === b.grouped &&
    a.gap?.from === b.gap?.from &&
    a.gap?.to === b.gap?.to &&
    a.unread === b.unread
  );
}
/** The row a seek key lands on; the first unread falls back to the newest row. */
export function locateRow(
  key: HistoryKey,
  rows: readonly HistoryRow[],
): string | undefined {
  if ("post" in key) return rows.find((row) => row.post.id === key.post)?.id;
  return (
    rows.find((row) => !row.post.failed && row.post.seq > key.unreadAfter)
      ?.id ?? rows[rows.length - 1]?.id
  );
}
