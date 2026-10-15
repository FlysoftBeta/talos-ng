import { concat, utf8Decode } from "@talos/base";
import { CHAT_TEXT_CHUNK } from "@talos/contract";
import { createMemoryCarrierPair, LinkClient } from "@talos/link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupChat } from "./test-helper.ts";
let s: ReturnType<typeof setupChat>;
let clients: LinkClient[];
beforeEach(() => {
  vi.useFakeTimers();
  s = setupChat();
  clients = [];
});
afterEach(() => {
  for (const client of clients) client.stop();
  s.close();
  vi.useRealTimers();
});
async function connect(user: string): Promise<LinkClient> {
  const client = new LinkClient({
    hello: () => ({ v: 1, build: "test", device: "device", lang: "zh-CN" }),
    connect: async () => {
      const pair = createMemoryCarrierPair();
      s.host.link.accept(pair.b, {}).ctx.set("test-user", user);
      return pair.a;
    },
  });
  clients.push(client);
  client.start();
  await vi.advanceTimersByTimeAsync(1);
  return client;
}
async function call(
  client: LinkClient,
  method: string,
  args: unknown,
  op?: string,
) {
  const promise = client.call(method, args, { op });
  // Attach immediately so deliberately rejected calls cannot produce unhandled rejections.
  const settled = promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error: error as unknown }),
  );
  await vi.advanceTimersByTimeAsync(1);
  const result = await settled;
  if (!result.ok) throw result.error;
  return result.value;
}
describe("chat over memory link", () => {
  it("deduplicates queued text facts and returns binary UTF-8 body", async () => {
    const client = await connect(s.users[0]!.id);
    const id = s.id(),
      op = s.id(),
      args = { id, conversation: s.conversation, kind: "text", text: "你好😀" };
    const first = await call(client, "chat.post.send", args, op);
    expect(await call(client, "chat.post.send", args, op)).toEqual(first);
    expect(s.chat.page({ conversation: s.conversation }).posts).toHaveLength(1);
    const body = await call(client, "chat.post.body", { id, offset: 0 });
    expect(utf8Decode(body.body!)).toBe("你好😀");
  });
  it("authorizes author-only edits, community moderation and muted deletion", async () => {
    const alice = await connect(s.users[0]!.id),
      bob = await connect(s.users[1]!.id);
    const id = s.id();
    await call(
      alice,
      "chat.post.send",
      { id, conversation: s.conversation, kind: "text", text: "消息" },
      s.id(),
    );
    await expect(
      call(bob, "chat.post.edit", { id, text: "冒充" }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await expect(call(bob, "chat.post.delete", { id })).rejects.toMatchObject({
      code: "E_DENIED",
    });
    s.chat.mute(s.users[0]!.id, 2000);
    await expect(
      call(alice, "chat.post.edit", { id, text: "修改" }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await call(alice, "chat.post.delete", { id });
    expect(s.chat.getPost(id).deletedAt).not.toBeNull();
  });
  it("denies membership-less reads, missing-image provenance and admin seams", async () => {
    const group = s.community.create(s.users[0]!.id, { name: "私密群" });
    const bob = await connect(s.users[1]!.id);
    await expect(
      call(bob, "chat.post.page", { conversation: group.id }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await expect(
      call(bob, "chat.file.fetch", { rid: "a".repeat(64), offset: 0 }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await expect(
      call(bob, "chat.announcement.publish", { title: "假公告", text: "内容" }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await expect(
      call(bob, "chat.user.mute", { user: s.users[0]!.id, until: 10000 }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
  });
  it("enforces admin-only posting and offline retention entitlement", async () => {
    const bob = await connect(s.users[1]!.id),
      outsider = await connect(s.users[2]!.id);
    const announcement = s.community
      .conversations(s.users[1]!.id)
      .find((c) => c.type === "announcement")!;
    await expect(
      call(
        bob,
        "chat.post.send",
        {
          id: s.id(),
          conversation: announcement.id,
          kind: "text",
          text: "不能发",
        },
        s.id(),
      ),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    const op = s.id();
    await expect(
      call(
        outsider,
        "chat.state.set",
        {
          conversation: s.conversation,
          key: "retention",
          value: { v: "week", t: { ms: 1000, counter: 0 }, op },
        },
        op,
      ),
    ).rejects.toMatchObject({ code: "E_DENIED" });
  });
  it("sends forty long CJK previews without exceeding frame header", async () => {
    const client = await connect(s.users[0]!.id);
    for (let i = 0; i < 40; i++)
      s.chat.send(s.users[0]!.id, {
        id: s.id(),
        conversation: s.conversation,
        kind: "text",
        text: "中文".repeat(1000),
      });
    const page = await call(client, "chat.post.page", {
      conversation: s.conversation,
      limit: 40,
    });
    expect((page.data as { posts: unknown[] }).posts).toHaveLength(40);
    expect(client.state).toBe("open");
  });
  it("caps escaped-control preview pages by bytes", async () => {
    const client = await connect(s.users[0]!.id);
    for (let i = 0; i < 40; i++)
      s.chat.send(s.users[0]!.id, {
        id: s.id(),
        conversation: s.conversation,
        kind: "text",
        text: "\u0001".repeat(1000),
      });
    const page = await call(client, "chat.post.page", {
      conversation: s.conversation,
      limit: 40,
    });
    const data = page.data as {
      posts: unknown[];
      last: number;
      hasBefore: boolean;
    };
    expect(data.posts.length).toBeLessThan(40);
    expect(data.last).toBe(40);
    expect(data.hasBefore).toBe(true);
    expect(client.state).toBe("open");
  });
  it("stages queued long text in strict order and decodes byte-split CJK", async () => {
    const client = await connect(s.users[0]!.id),
      textId = s.id(),
      id = s.id(),
      text = "中文😀".repeat(9000);
    for (let offset = 0; offset < text.length; offset += CHAT_TEXT_CHUNK)
      await call(
        client,
        "chat.text.put",
        {
          id: textId,
          offset,
          total: text.length,
          text: text.slice(offset, offset + CHAT_TEXT_CHUNK),
        },
        s.id(),
      );
    await call(
      client,
      "chat.post.send",
      { id, conversation: s.conversation, kind: "text", textId },
      s.id(),
    );
    const parts: Uint8Array[] = [];
    let offset = 0;
    for (;;) {
      const chunk = await call(client, "chat.post.body", {
        id,
        offset,
        limit: 10001,
      });
      parts.push(chunk.body!);
      offset += chunk.body!.length;
      if ((chunk.data as { eof: boolean }).eof) break;
    }
    expect(utf8Decode(concat(...parts))).toBe(text);
    expect(s.incidents).toEqual([]);
  });
  it("validates queued LWW op identities and invalid setting values", async () => {
    const client = await connect(s.users[0]!.id);
    await expect(
      call(
        client,
        "chat.state.set",
        {
          conversation: s.conversation,
          key: "pin",
          value: { v: true, t: { ms: 1000, counter: 0 }, op: s.id() },
        },
        s.id(),
      ),
    ).rejects.toMatchObject({ code: "E_INVALID" });
    const op = s.id();
    await expect(
      call(
        client,
        "chat.state.set",
        {
          conversation: s.conversation,
          key: "mute",
          value: { v: "wrong", t: { ms: 1000, counter: 0 }, op },
        },
        op,
      ),
    ).rejects.toMatchObject({ code: "E_INVALID" });
  });
});
