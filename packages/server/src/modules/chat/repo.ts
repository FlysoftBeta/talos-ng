import type {
  ChatAnnouncement,
  ChatPost,
  ChatState,
  ChatSticker,
} from "@talos/contract";
import type { Row } from "@talos/sync";
import type { Db } from "../../kernel/persistence/db.ts";
interface DataRecord {
  data: string;
  rev: number;
  deleted: number;
}
export interface TextRecord {
  id: string;
  user: string;
  total: number;
  body: string;
  updated: number;
}
export class ChatRepo {
  constructor(private readonly db: Db) {}
  post(id: string): ChatPost | undefined {
    const row = this.db.get<DataRecord>(
      "SELECT data FROM chat_posts WHERE id=?",
      id,
    );
    return row ? (JSON.parse(row.data) as ChatPost) : undefined;
  }
  body(id: string): string | undefined {
    return this.db.get<{ body: string }>(
      "SELECT body FROM chat_posts WHERE id=?",
      id,
    )?.body;
  }
  latest(conversation: string): ChatPost | undefined {
    const row = this.db.get<DataRecord>(
      "SELECT data FROM chat_posts WHERE conversation=? ORDER BY seq DESC LIMIT 1",
      conversation,
    );
    return row ? (JSON.parse(row.data) as ChatPost) : undefined;
  }
  putPost(post: ChatPost, body: string): void {
    this.db.run(
      "INSERT INTO chat_posts VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,data=excluded.data,rev=excluded.rev,deleted=excluded.deleted",
      post.id,
      post.conversation,
      post.seq,
      post.author,
      body,
      JSON.stringify(post),
      post.rev,
      post.deletedAt === null ? 0 : 1,
    );
  }
  page(
    conversation: string,
    start: number,
    end: number,
    limit: number,
  ): ChatPost[] {
    return this.db
      .all<DataRecord>(
        "SELECT data FROM chat_posts WHERE conversation=? AND seq>=? AND seq<=? ORDER BY seq LIMIT ?",
        conversation,
        start,
        end,
        limit,
      )
      .map((row) => JSON.parse(row.data) as ChatPost);
  }
  postRows(conversation: string, since: number, limit: number): Row[] {
    return this.db
      .all<DataRecord>(
        "SELECT * FROM chat_posts WHERE conversation=? AND rev>? ORDER BY rev,id LIMIT ?",
        conversation,
        since,
        limit,
      )
      .map((row) => this.postRow(JSON.parse(row.data) as ChatPost));
  }
  postRow(post: ChatPost): Row {
    return {
      type: "post",
      id: post.id,
      rev: post.rev,
      deleted: post.deletedAt !== null,
      data: post,
    };
  }
  state(user: string, conversation: string): ChatState | undefined {
    const row = this.db.get<DataRecord>(
      "SELECT * FROM chat_states WHERE user=? AND conversation=? AND deleted=0",
      user,
      conversation,
    );
    return row ? (JSON.parse(row.data) as ChatState) : undefined;
  }
  putState(user: string, state: ChatState, rev: number, deleted = false): void {
    this.db.run(
      "INSERT INTO chat_states VALUES(?,?,?,?,?) ON CONFLICT(user,conversation) DO UPDATE SET data=excluded.data,rev=excluded.rev,deleted=excluded.deleted",
      user,
      state.conversation,
      JSON.stringify(state),
      rev,
      deleted ? 1 : 0,
    );
  }
  stateRow(user: string, conversation: string): Row | undefined {
    const row = this.db.get<DataRecord>(
      "SELECT * FROM chat_states WHERE user=? AND conversation=?",
      user,
      conversation,
    );
    return row
      ? {
          type: "chatState",
          id: conversation,
          rev: row.rev,
          deleted: !!row.deleted,
          data: row.deleted ? null : (JSON.parse(row.data) as ChatState),
        }
      : undefined;
  }
  stateRows(user: string, since: number, limit: number): Row[] {
    return this.db
      .all<DataRecord & { conversation: string }>(
        "SELECT * FROM chat_states WHERE user=? AND rev>? ORDER BY rev,conversation LIMIT ?",
        user,
        since,
        limit,
      )
      .map((row) => this.stateRow(user, row.conversation)!);
  }
  text(id: string): TextRecord | undefined {
    const row = this.db.get<TextRecord>(
      "SELECT * FROM chat_texts WHERE id=?",
      id,
    );
    return row ? { ...row, body: JSON.parse(row.body) as string } : undefined;
  }
  putText(row: TextRecord): void {
    this.db.run(
      "INSERT INTO chat_texts VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated=excluded.updated",
      row.id,
      row.user,
      row.total,
      JSON.stringify(row.body),
      row.updated,
    );
  }
  sticker(id: string): ChatSticker | undefined {
    const row = this.db.get<{ data: string }>(
      "SELECT data FROM chat_stickers WHERE id=?",
      id,
    );
    return row ? (JSON.parse(row.data) as ChatSticker) : undefined;
  }
  stickers(offset: number, limit: number): ChatSticker[] {
    return this.db
      .all<{ data: string }>(
        "SELECT data FROM chat_stickers ORDER BY id LIMIT ? OFFSET ?",
        limit,
        offset,
      )
      .map((row) => JSON.parse(row.data) as ChatSticker);
  }
  putSticker(sticker: ChatSticker): void {
    this.db.run(
      "INSERT OR REPLACE INTO chat_stickers VALUES(?,?)",
      sticker.id,
      JSON.stringify(sticker),
    );
  }
  stickerFile(rid: string): boolean {
    return !!this.db.get(
      "SELECT 1 FROM chat_stickers WHERE json_extract(data,'$.file.rid')=?",
      rid,
    );
  }
  postFile(conversation: string, rid: string): boolean {
    return !!this.db.get(
      "SELECT 1 FROM chat_posts WHERE conversation=? AND deleted=0 AND (json_extract(data,'$.image.original.rid')=? OR json_extract(data,'$.image.thumbnail.rid')=?)",
      conversation,
      rid,
      rid,
    );
  }
  announcement(): ChatAnnouncement | undefined {
    const row = this.db.get<{ data: string }>(
      "SELECT data FROM chat_announcements WHERE id='current'",
    );
    return row ? (JSON.parse(row.data) as ChatAnnouncement) : undefined;
  }
  putAnnouncement(value: ChatAnnouncement, rev: number): void {
    this.db.run(
      "INSERT INTO chat_announcements VALUES('current',?,?,0) ON CONFLICT(id) DO UPDATE SET data=excluded.data,rev=excluded.rev",
      JSON.stringify(value),
      rev,
    );
  }
  announcementRow(): Row | undefined {
    const row = this.db.get<DataRecord>(
      "SELECT * FROM chat_announcements WHERE id='current'",
    );
    return row
      ? {
          type: "announcement",
          id: "current",
          rev: row.rev,
          deleted: false,
          data: JSON.parse(row.data) as ChatAnnouncement,
        }
      : undefined;
  }
  ack(user: string): Row | undefined {
    const row = this.db.get<{ revision: number; rev: number }>(
      "SELECT * FROM chat_ack WHERE user=?",
      user,
    );
    return row
      ? {
          type: "announcementAck",
          id: "current",
          rev: row.rev,
          deleted: false,
          data: { id: "current", revision: row.revision },
        }
      : undefined;
  }
  putAck(user: string, revision: number, rev: number): void {
    this.db.run(
      "INSERT INTO chat_ack VALUES(?,?,?,0) ON CONFLICT(user) DO UPDATE SET revision=max(revision,excluded.revision),rev=excluded.rev",
      user,
      revision,
      rev,
    );
  }
  mutedUntil(user: string): number {
    return (
      this.db.get<{ until: number }>(
        "SELECT until FROM chat_mutes WHERE user=?",
        user,
      )?.until ?? 0
    );
  }
  putMute(user: string, until: number, rev: number): void {
    this.db.run(
      "INSERT INTO chat_mutes VALUES(?,?,?,0) ON CONFLICT(user) DO UPDATE SET until=excluded.until,rev=excluded.rev",
      user,
      until,
      rev,
    );
  }
}
