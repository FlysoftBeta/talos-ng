// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatPost, CommunityConversation } from "@talos/contract";
import type { StoredRow } from "../../../core/data/db.ts";
import { ConversationController } from "./conversation.ts";
import { initialState } from "./module.ts";
import type { ConversationPort } from "./ports.ts";
import { fullBody, page } from "./commands.ts";

vi.mock("./commands.ts", () => ({
  page: vi.fn(),
  fullBody: vi.fn(),
  message: (error: Error) => error.message,
}));

const post = (seq: number): ChatPost => ({
  id: `post${seq}`,
  conversation: "group",
  seq,
  rev: seq,
  author: "user",
  authorName: "User",
  kind: "text",
  preview: "text",
  bodyLength: 4,
  replyTo: null,
  created: 1000,
  edited: null,
  deletedAt: null,
  image: null,
  sticker: null,
});
const win = (seqs: number[], more: Partial<{ hasBefore: boolean }> = {}) => ({
  posts: seqs.map(post),
  first: seqs[0] ?? 0,
  last: seqs.at(-1) ?? 0,
  latest: 10,
  hasBefore: true,
  hasAfter: false,
  ...more,
});
const stored = (seqs: number[]) =>
  seqs.map(
    (seq) =>
      ({
        scope: "conv:group",
        type: "post",
        id: `post${seq}`,
        rev: seq,
        deleted: false,
        data: post(seq),
      }) as StoredRow,
  );
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function fixture(
  options: {
    online?: boolean;
    readSeq?: number;
    lastSeq?: number;
    rows?: number[];
  } = {},
) {
  let online = options.online ?? true;
  const runtime = {
    can: () => ({ ok: online }),
    sync: vi.fn(async () => {}),
    outbox: vi.fn(() => []),
    getSnapshot: () => ({ user: { id: "user" } }),
    command: vi.fn(async () => ({})),
    time: () => 1000,
  };
  const input = {
    group: { id: "group", name: "G" } as CommunityConversation,
    state: {
      ...initialState("group"),
      readSeq: options.readSeq ?? 2,
      lastSeq: options.lastSeq ?? 4,
    },
    rows: stored(options.rows ?? [3, 4]),
  };
  const model = new ConversationController(
    runtime as unknown as ConversationPort,
    input,
  );
  /** Plays the browser: a 200 px viewport where every post is 100 px tall. */
  const layout = () => {
    for (let i = 0; i < 10; i++)
      model.history.sense({
        viewport: 200,
        sizes: model.history
          .getSnapshot()
          .items.map((row) => [row.id, 100] as const),
      });
  };
  const open = async () => {
    model.update(input);
    await settle();
    layout();
    await settle();
    layout();
  };
  return {
    model,
    input,
    runtime,
    layout,
    open,
    setOnline: (value: boolean) => (online = value),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(page).mockResolvedValue(win([], { hasBefore: false }));
});

describe("opening a conversation", () => {
  it("opens at the first unread post and marks what is fully visible read", async () => {
    const t = fixture({ rows: [1, 2, 3, 4, 5, 6], lastSeq: 6 });
    await t.open();
    expect(t.model.history.position()).toEqual({ id: "post3", offset: 0 });
    expect(t.runtime.sync).toHaveBeenCalled();
    expect(t.runtime.command).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "chat.state.read" }),
      { conversation: "group", seq: 4 },
    );
    expect(t.model.getState()).toMatchObject({ read: 4, awayFromBottom: true });
  });
  it("fetches the posts around the first unread one when they are not cached", async () => {
    const t = fixture({ rows: [1, 2], readSeq: 5, lastSeq: 20 });
    vi.mocked(page).mockResolvedValueOnce(win([6, 7, 8]));
    await t.open();
    expect(page).toHaveBeenCalledWith(t.runtime, "group", "around", 6);
    expect(t.model.history.position()?.id).toBe("post6");
  });
  it("opens offline at the newest cached post when nothing newer is cached", async () => {
    const t = fixture({ online: false, readSeq: 9, lastSeq: 10 });
    await t.open();
    expect(page).not.toHaveBeenCalled();
    expect(t.model.history.visible().pop()?.id).toBe("post4");
  });
  it("opens at the end and follows it when everything was read", async () => {
    const t = fixture({ readSeq: 4, rows: [1, 2, 3, 4] });
    await t.open();
    expect(t.model.history.getSnapshot().atEnd).toBe(true);
    expect(t.model.getState().awayFromBottom).toBe(false);
  });
});

describe("loading at the ends", () => {
  it("pages older posts in at the top until the first post", async () => {
    const t = fixture({ readSeq: 4 });
    vi.mocked(page).mockResolvedValueOnce(win([1, 2], { hasBefore: false }));
    await t.open();
    t.model.history.scrollBy(-1000);
    t.layout();
    await settle();
    t.layout();
    expect(page).toHaveBeenCalledWith(t.runtime, "group", "before", 3);
    expect(t.model.history.ids()).toEqual(["post1", "post2", "post3", "post4"]);
    expect(t.model.history.getSnapshot().before.more).toBe(false);
  });
  it("pages newer posts in at the bottom, never past the latest", async () => {
    const t = fixture({ readSeq: 2, rows: [3, 4], lastSeq: 6 });
    vi.mocked(page).mockResolvedValueOnce(win([5, 6]));
    await t.open();
    t.model.history.scrollBy(1000);
    t.layout();
    await settle();
    t.layout();
    expect(page).toHaveBeenCalledWith(t.runtime, "group", "after", 4);
    expect(t.model.history.getSnapshot().after.more).toBe(false);
  });
  it("explains an offline end and loads it once connectivity returns", async () => {
    const t = fixture({ online: false, readSeq: 4 });
    await t.open();
    t.model.history.scrollBy(-1000);
    t.layout();
    await settle();
    const before = t.model.history.getSnapshot().before;
    expect(before.state).toBe("failed");
    expect((before.error as Error).message).toContain("没有保存在本机");
    t.setOnline(true);
    vi.mocked(page).mockResolvedValueOnce(win([1, 2], { hasBefore: false }));
    t.model.update(t.input);
    t.layout();
    await settle();
    expect(page).toHaveBeenCalledWith(t.runtime, "group", "before", 3);
  });
});

describe("jumping to a quoted post", () => {
  it("centres a post that is already loaded", async () => {
    const t = fixture({ rows: [1, 2, 3, 4, 5, 6], readSeq: 6, lastSeq: 6 });
    await t.open();
    await t.model.jump("post2", 5);
    t.layout();
    const { history } = t.model;
    expect(history.offsetOf("post2")! - history.geometry().top).toBe(50);
    expect(page).not.toHaveBeenCalled();
  });
  it("explains that an uncached quote cannot be fetched offline", async () => {
    const t = fixture({ online: false });
    await t.open();
    await t.model.jump("old", 3);
    expect(t.model.getState().error).toContain("离线");
    expect(page).not.toHaveBeenCalled();
  });
  it("pages back to an uncached quote, and reports a vanished one", async () => {
    const t = fixture({ readSeq: 4 });
    await t.open();
    vi.mocked(page).mockResolvedValueOnce(win([1, 2], { hasBefore: false }));
    await t.model.jump("post1", 3);
    expect(page).toHaveBeenCalledWith(t.runtime, "group", "before", 3);
    expect(t.model.history.has("post1")).toBe(true);
    expect(t.model.getState()).toMatchObject({ loading: false, error: "" });
    await t.model.jump("gone", 3);
    expect(t.model.getState().error).toBe("引用的消息已不可用");
  });
  it("stops paging back at a boundary that does not advance", async () => {
    const t = fixture({ readSeq: 4 });
    await t.open();
    vi.mocked(page).mockClear();
    vi.mocked(page).mockResolvedValue({ ...win([]), first: 3 });
    await t.model.jump("lost", 3);
    expect(page).toHaveBeenCalledTimes(1);
    expect(t.model.getState().error).toBe("引用的消息已不可用");
  });
  it("surfaces a failed fetch", async () => {
    const t = fixture({ readSeq: 4 });
    await t.open();
    vi.mocked(page).mockRejectedValueOnce(new Error("boom"));
    await t.model.jump("x", 3);
    expect(t.model.getState()).toMatchObject({ error: "boom", loading: false });
  });
});

describe("read marker", () => {
  it("reports read failures", async () => {
    const t = fixture({ readSeq: 2, rows: [3, 4] });
    t.runtime.command.mockRejectedValueOnce(new Error("offline"));
    await t.open();
    expect(t.model.getState()).toMatchObject({ error: "offline", read: 4 });
  });
  it("shows a full-text load failure and clears loading", async () => {
    const t = fixture();
    vi.mocked(fullBody).mockRejectedValueOnce(new Error("gone"));
    await t.model.view(post(3), true);
    expect(t.model.getState()).toMatchObject({
      error: "gone",
      textLoading: false,
    });
  });
});
