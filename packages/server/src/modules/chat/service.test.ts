import { concat, utf8Decode } from "@talos/base";
import { CHAT_TEXT_CHUNK } from "@talos/contract";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupChat } from "./test-helper.ts";
let current: ReturnType<typeof setupChat> | undefined;
afterEach(() => {
  current?.close();
  current = undefined;
});
function setup() {
  current = setupChat();
  return current;
}
function send(
  s: ReturnType<typeof setupChat>,
  text = "你好",
  conversation = s.conversation,
) {
  return s.chat.send(s.users[0]!.id, {
    id: s.id(),
    conversation,
    kind: "text",
    text,
  }).post;
}
describe("chat facts and windows", () => {
  it("assigns conversation-local sequences and rejects reused identity", () => {
    const s = setup();
    const first = send(s);
    const second = send(s);
    const other = s.community
      .conversations(s.users[0]!.id)
      .find((c) => c.type === "announcement")!.id;
    expect(send(s, "公告", other).seq).toBe(1);
    expect([first.seq, second.seq]).toEqual([1, 2]);
    expect(() =>
      s.chat.send(s.users[0]!.id, {
        id: first.id,
        conversation: s.conversation,
        kind: "text",
        text: "重复",
      }),
    ).toThrow();
  });
  it("maintains all sequence slots in both directions through 500 posts", () => {
    const s = setup();
    for (let i = 0; i < 500; i++) send(s, `消息${i}`);
    const around = s.chat.page({
      conversation: s.conversation,
      direction: "around",
      anchor: 250,
      limit: 40,
    });
    expect(around.posts.map((p) => p.seq)).toEqual(
      Array.from({ length: 40 }, (_, i) => 230 + i),
    );
    expect(around.hasBefore && around.hasAfter).toBe(true);
    expect(
      s.chat.page({
        conversation: s.conversation,
        direction: "before",
        anchor: 230,
        limit: 40,
      }).last,
    ).toBe(229);
    expect(
      s.chat.page({
        conversation: s.conversation,
        direction: "after",
        anchor: 269,
        limit: 40,
      }).first,
    ).toBe(270);
    expect(s.chat.page({ conversation: s.conversation }).last).toBe(500);
  });
  it("reports empty window boundaries without fictitious gaps", () => {
    const s = setup();
    expect(s.chat.page({ conversation: s.conversation })).toMatchObject({
      posts: [],
      first: 0,
      last: 0,
      latest: 0,
      hasBefore: false,
      hasAfter: false,
    });
  });
  it("preserves reply identity and makes tombstones permanent", () => {
    const s = setup();
    const post = send(s);
    const reply = s.chat.send(s.users[0]!.id, {
      id: s.id(),
      conversation: s.conversation,
      kind: "text",
      text: "回答",
      replyTo: post.id,
    }).post;
    const deleted = s.chat.delete(post.id).post;
    expect(deleted).toMatchObject({
      id: post.id,
      seq: 1,
      deletedAt: 1000,
      preview: "",
    });
    expect(s.chat.getPost(reply.id).replyTo).toBe(post.id);
    expect(s.chat.page({ conversation: s.conversation }).posts).toHaveLength(2);
    expect(() =>
      s.chat.edit(s.users[0]!.id, { id: post.id, text: "恢复" }),
    ).toThrow();
    expect(() => s.chat.body({ id: post.id, offset: 0 })).toThrow();
    expect(s.chat.delete(post.id).post.rev).toBe(deleted.rev);
  });
  it("rejects replies to another conversation or tombstone", () => {
    const s = setup();
    const post = send(s);
    const other = s.community
      .conversations(s.users[0]!.id)
      .find((c) => c.type === "announcement")!.id;
    expect(() =>
      s.chat.send(s.users[0]!.id, {
        id: s.id(),
        conversation: other,
        kind: "text",
        text: "答",
        replyTo: post.id,
      }),
    ).toThrow();
    s.chat.delete(post.id);
    expect(() =>
      s.chat.send(s.users[0]!.id, {
        id: s.id(),
        conversation: s.conversation,
        kind: "text",
        text: "答",
        replyTo: post.id,
      }),
    ).toThrow();
  });
  it("edits body and preview without changing immutable identity", () => {
    const s = setup();
    const first = send(s);
    s.setTime(2000);
    const edited = s.chat.edit(s.users[0]!.id, {
      id: first.id,
      text: "更改",
    }).post;
    expect(edited).toMatchObject({
      id: first.id,
      seq: first.seq,
      created: first.created,
      edited: 2000,
      preview: "更改",
    });
    expect(utf8Decode(s.chat.body({ id: first.id, offset: 0 }).body)).toBe(
      "更改",
    );
  });
  it("rejects empty messages and unknown stickers", () => {
    const s = setup();
    expect(() => send(s, " \n ")).toThrow();
    expect(() =>
      s.chat.send(s.users[0]!.id, {
        id: s.id(),
        conversation: s.conversation,
        kind: "sticker",
        sticker: "missing",
      }),
    ).toThrow();
  });
  it("publishes text changes and per-user conversation summaries atomically", () => {
    const s = setup();
    for (const u of s.users) s.chat.ensureStates(u.id);
    const events: unknown[] = [];
    s.hub.pull(
      s.users[1]!.id,
      { cursors: {} },
      { id: "bob", emit: (_topic, data) => events.push(data) },
    );
    const post = send(s);
    expect(events).toHaveLength(1);
    const delta = events[0] as {
      scopes: Record<string, { rows: { type: string }[] }>;
    };
    expect(
      delta.scopes[`conv:${s.conversation}`]!.rows.some(
        (r) => r.type === "post",
      ),
    ).toBe(true);
    expect(
      delta.scopes[`me:${s.users[1]!.id}`]!.rows.some(
        (r) => r.type === "chatState",
      ),
    ).toBe(true);
    expect(s.chat.state(s.users[1]!.id, s.conversation).lastPost?.id).toBe(
      post.id,
    );
    expect(s.incidents).toEqual([]);
  });
  it("resets post windows once the delta threshold is exceeded", () => {
    const s = setup();
    for (let i = 0; i < 500; i++) send(s, String(i));
    const response = s.hub.pull(s.users[0]!.id, {
      cursors: {},
      windowed: [`conv:${s.conversation}`],
    });
    expect(response.scopes[`conv:${s.conversation}`]!.reset).toContain("post");
  });
});
describe("chat long text", () => {
  it("supports exactly 5,000,000 UTF-16 characters and bounded binary reads", () => {
    const s = setup(),
      textId = s.id(),
      user = s.users[0]!.id;
    const text = "中文😀".repeat(1_250_000);
    for (let offset = 0; offset < text.length; offset += CHAT_TEXT_CHUNK)
      s.chat.putText(user, {
        id: textId,
        offset,
        total: text.length,
        text: text.slice(offset, offset + CHAT_TEXT_CHUNK),
      });
    const post = s.chat.send(user, {
      id: s.id(),
      conversation: s.conversation,
      kind: "text",
      textId,
    }).post;
    expect(post.bodyLength).toBe(5_000_000);
    expect(post.preview.length).toBeLessThanOrEqual(1000);
    const chunks: Uint8Array[] = [];
    let offset = 0;
    for (;;) {
      const part = s.chat.body({ id: post.id, offset });
      expect(part.body.length).toBeLessThanOrEqual(512 * 1024);
      chunks.push(part.body);
      offset += part.body.length;
      if (part.data.eof) break;
    }
    expect(utf8Decode(concat(...chunks))).toBe(text);
  }, 120_000);
  it("preserves emoji split across a UTF-16 chunk boundary and SQL roundtrip", () => {
    const s = setup(),
      user = s.users[0]!.id,
      id = s.id();
    const text = "a".repeat(CHAT_TEXT_CHUNK - 1) + "😀尾";
    s.chat.putText(user, {
      id,
      offset: 0,
      total: text.length,
      text: text.slice(0, CHAT_TEXT_CHUNK),
    });
    expect(s.chat.repo.text(id)!.body).toBe(text.slice(0, CHAT_TEXT_CHUNK));
    s.chat.putText(user, {
      id,
      offset: CHAT_TEXT_CHUNK,
      total: text.length,
      text: text.slice(CHAT_TEXT_CHUNK),
    });
    const post = s.chat.send(user, {
      id: s.id(),
      conversation: s.conversation,
      kind: "text",
      textId: id,
    }).post;
    expect(utf8Decode(s.chat.body({ id: post.id, offset: 0 }).body)).toBe(text);
  });
  it("rejects oversize, reordered, conflicting and foreign text chunks", () => {
    const s = setup(),
      id = s.id(),
      user = s.users[0]!.id;
    expect(() =>
      s.chat.putText(user, { id, offset: 0, total: 5_000_001, text: "x" }),
    ).toThrow();
    expect(() =>
      s.chat.putText(user, { id, offset: 1, total: 4, text: "ab" }),
    ).toThrow();
    s.chat.putText(user, { id, offset: 0, total: 4, text: "ab" });
    expect(
      s.chat.putText(user, { id, offset: 0, total: 4, text: "ab" }),
    ).toEqual({ offset: 2 });
    expect(() =>
      s.chat.putText(user, { id, offset: 0, total: 4, text: "zz" }),
    ).toThrow();
    expect(() =>
      s.chat.putText(s.users[1]!.id, { id, offset: 2, total: 4, text: "cd" }),
    ).toThrow();
    expect(() =>
      s.chat.send(user, {
        id: s.id(),
        conversation: s.conversation,
        kind: "text",
        textId: id,
      }),
    ).toThrow();
  });
  it("keeps staged bodies private and rejects out-of-range reads", () => {
    const s = setup(),
      id = s.id(),
      user = s.users[0]!.id;
    s.chat.putText(user, { id, offset: 0, total: 2, text: "中文" });
    expect(() => s.chat.textBody(s.users[1]!.id, { id, offset: 0 })).toThrow();
    expect(() => s.chat.textBody(user, { id, offset: 7 })).toThrow();
    expect(s.chat.textBody(user, { id, offset: 6 }).data.eof).toBe(true);
  });
});
describe("chat state convergence", () => {
  it("merges read positions with Max and rejects future positions", () => {
    const s = setup(),
      u = s.users[0]!.id;
    for (let i = 0; i < 10; i++) send(s);
    for (const seq of [4, 2, 10, 1, 7])
      s.chat.read(u, { conversation: s.conversation, seq });
    expect(s.chat.state(u, s.conversation).readSeq).toBe(10);
    expect(() =>
      s.chat.read(u, { conversation: s.conversation, seq: 11 }),
    ).toThrow();
  });
  it("converges LWW regardless of reordered pin/mute/draft writes", () => {
    const s = setup(),
      u = s.users[0]!.id;
    for (const key of ["pin", "mute", "draft", "retention"] as const) {
      const newest = {
        v: key === "draft" ? "草稿" : key === "retention" ? "week" : true,
        t: { ms: 1000, counter: 2 },
        op: s.id(),
      };
      s.chat.setState(u, { conversation: s.conversation, key, value: newest });
      s.chat.setState(u, {
        conversation: s.conversation,
        key,
        value: {
          ...newest,
          v: key === "draft" ? "旧" : key === "retention" ? "auto" : false,
          t: { ms: 1000, counter: 1 },
          op: s.id(),
        },
      });
      expect(s.chat.state(u, s.conversation)[key]).toEqual(newest);
    }
  });
  it("validates each setting's domain and clamps future stamps", () => {
    const s = setup(),
      u = s.users[0]!.id;
    expect(() =>
      s.chat.setState(u, {
        conversation: s.conversation,
        key: "pin",
        value: { v: "yes", t: { ms: 0, counter: 0 }, op: s.id() },
      }),
    ).toThrow();
    const result = s.chat.setState(u, {
      conversation: s.conversation,
      key: "draft",
      value: {
        v: "字",
        t: { ms: Number.MAX_SAFE_INTEGER, counter: 0 },
        op: s.id(),
      },
    });
    expect(result.state.draft.t.ms).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
  it("tracks giant draft references without putting their body in synced rows", () => {
    const s = setup(),
      u = s.users[0]!.id,
      id = s.id();
    s.chat.putText(u, { id, offset: 0, total: 3, text: "草稿字" });
    const result = s.chat.setState(u, {
      conversation: s.conversation,
      key: "draft",
      value: { v: "草稿字", t: { ms: 1000, counter: 0 }, op: s.id() },
      textId: id,
    });
    expect(result.state.draftTextId).toBe(id);
  });
  it("retains whitespace-only staged drafts and rejects invalid stale settings", () => {
    const s = setup(),
      user = s.users[0]!.id,
      id = s.id();
    s.chat.putText(user, { id, offset: 0, total: 3, text: " \n " });
    const state = s.chat.setState(user, {
      conversation: s.conversation,
      key: "draft",
      value: { v: " \n ", t: { ms: 1000, counter: 0 }, op: s.id() },
      textId: id,
    }).state;
    expect(state.draftTextId).toBe(id);
    expect(state.draft.v).toBe(" \n ");
    expect(() =>
      s.chat.setState(user, {
        conversation: s.conversation,
        key: "draft",
        value: { v: true, t: { ms: 0, counter: 0 }, op: s.id() },
      }),
    ).toThrow(/设置值无效/);
  });
  it("mute expires on injected clock and prevents posting until then", () => {
    const s = setup(),
      u = s.users[0]!.id;
    s.chat.mute(u, 2000);
    expect(() => s.chat.requirePost(u, s.conversation)).toThrow();
    s.setTime(2000);
    expect(() => s.chat.requirePost(u, s.conversation)).not.toThrow();
    expect(s.chat.state(u, s.conversation).mutedUntil).toBe(2000);
  });
  it("acknowledgments cannot hide a later announcement", () => {
    const s = setup(),
      u = s.users[0]!.id;
    const first = s.chat.publish({
      title: "公告",
      text: "第一次",
    }).announcement;
    s.chat.ack(u, first.revision);
    const next = s.chat.publish({ title: "公告", text: "第二次" }).announcement;
    s.chat.ack(u, first.revision);
    expect((s.chat.repo.ack(u)!.data as { revision: number }).revision).toBe(
      first.revision,
    );
    expect(next.revision).toBeGreaterThan(first.revision);
    expect(() => s.chat.ack(u, next.revision + 1)).toThrow();
  });
});
describe("chat image ledger", () => {
  it("prepares thumbnails without publishing unowned files and rechecks revoked permission at commit", async () => {
    const s = setup(),
      user = s.users[0]!.id;
    const source = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const upload = await s.uploads.begin(user, {
      kind: "image",
      size: source.length,
    });
    await s.uploads.append(user, { id: upload.id, offset: 0 }, source);
    await s.uploads.commit(user, { id: upload.id });
    const prepared = await s.chat.assets.prepareImage(user, upload.id);
    expect(await s.store.has(prepared.image.thumbnail.rid)).toBe(false);
    const put = s.store.put.bind(s.store);
    vi.spyOn(s.store, "put").mockImplementation(async (...args) => {
      const info = await put(...args);
      s.chat.mute(user, 2000);
      return info;
    });
    await expect(
      s.chat.image(user, {
        id: s.id(),
        conversation: s.conversation,
        upload: upload.id,
      }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    expect(s.chat.page({ conversation: s.conversation }).posts).toEqual([]);
    expect(s.uploads.getCommitted(user, upload.id).size).toBe(source.length);
    expect(
      s.db.all("SELECT * FROM object_refs WHERE owner_kind='chat-post'"),
    ).toEqual([]);
  });
  it("generates thumbnail server-side, transfers ownership and removes refs on deletion", async () => {
    const s = setup(),
      u = s.users[0]!.id;
    const source = await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 4,
        background: { r: 255, g: 51, b: 102, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const upload = await s.uploads.begin(u, {
      kind: "image",
      size: source.length,
    });
    await s.uploads.append(u, { id: upload.id, offset: 0 }, source);
    await s.uploads.commit(u, { id: upload.id });
    const post = (
      await s.chat.image(u, {
        id: s.id(),
        conversation: s.conversation,
        upload: upload.id,
      })
    ).post;
    expect(post.image!.thumbnail).toMatchObject({
      width: 480,
      height: 240,
      mime: "image/jpeg",
    });
    expect(await s.store.has(post.image!.original.rid)).toBe(true);
    expect(
      s.db.all("SELECT * FROM object_refs WHERE owner_kind='chat-post'"),
    ).toHaveLength(2);
    expect(() => s.uploads.getCommitted(u, upload.id)).toThrow();
    s.chat.delete(post.id);
    expect(
      s.db.all("SELECT * FROM object_refs WHERE owner_kind='chat-post'"),
    ).toHaveLength(0);
  });
  it("rejects corrupt images while preserving the upload for retry", async () => {
    const s = setup(),
      u = s.users[0]!.id;
    const source = new Uint8Array([137, 80, 78, 71, 0]);
    const upload = await s.uploads.begin(u, {
      kind: "image",
      size: source.length,
    });
    await s.uploads.append(u, { id: upload.id, offset: 0 }, source);
    await s.uploads.commit(u, { id: upload.id });
    await expect(
      s.chat.image(u, {
        id: s.id(),
        conversation: s.conversation,
        upload: upload.id,
      }),
    ).rejects.toMatchObject({ code: "E_INVALID" });
    expect(s.uploads.getCommitted(u, upload.id).size).toBe(source.length);
  });
  it("distinguishes an absent object from an invalid read range", async () => {
    const s = setup();
    await expect(
      s.chat.assets.fetch({ rid: "a".repeat(64), offset: 0 }),
    ).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    const info = await s.store.put(new Uint8Array([1, 2]));
    await expect(
      s.chat.assets.fetch({ rid: info.id, offset: 3 }),
    ).rejects.toMatchObject({ code: "E_INVALID" });
  });
});

describe("chat seed assets", () => {
  it("seeds every legacy sticker through the ledger and paginates the catalog", async () => {
    const s = setup();
    const first = await s.chat.assets.list(0, 100);
    expect(first.stickers).toHaveLength(100);
    expect(first.next).toBe(100);
    const last = await s.chat.assets.list(1000, 100);
    expect(last.stickers).toHaveLength(62);
    expect(last.next).toBeNull();
    expect(
      s.db.all("SELECT * FROM object_refs WHERE owner_kind='chat-sticker'"),
    ).toHaveLength(1062);
    const sticker = first.stickers[0]!;
    const post = s.chat.send(s.users[0]!.id, {
      id: s.id(),
      conversation: s.conversation,
      kind: "sticker",
      sticker: sticker.id,
    }).post;
    expect(post.sticker).toEqual(sticker);
    expect(
      (await s.chat.assets.fetch({ rid: sticker.file.rid, offset: 0 })).body
        .length,
    ).toBeGreaterThan(0);
    expect(() =>
      s.chat.edit(s.users[0]!.id, { id: post.id, text: "不能编辑" }),
    ).toThrow();
    await s.chat.ready;
    expect(
      s.db.all("SELECT * FROM object_refs WHERE owner_kind='chat-sticker'"),
    ).toHaveLength(1062);
  }, 120_000);
});
