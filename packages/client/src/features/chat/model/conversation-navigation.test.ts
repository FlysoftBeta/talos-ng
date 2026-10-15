// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { ChatPost, CommunityConversation } from "@talos/contract";
import type { StoredRow } from "../../../core/data/db.ts";
import { ConversationController } from "./conversation.ts";
import { initialState } from "./module.ts";
import type { ConversationPort } from "./ports.ts";
import { fullBody, loadReply, page } from "./commands.ts";

vi.mock("./commands.ts", () => ({
  page: vi.fn(),
  fullBody: vi.fn(),
  loadReply: vi.fn(),
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
const win = (seqs: number[]) => ({
  posts: seqs.map(post),
  first: seqs[0] ?? 0,
  last: seqs.at(-1) ?? 0,
  latest: 10,
  hasBefore: true,
  hasAfter: false,
});
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function fixture(
  options: { online?: boolean; readSeq?: number; lastSeq?: number } = {},
) {
  vi.clearAllMocks();
  let online = options.online ?? true;
  let facts:
    { top: number; bottom: number; visibleSequences: number[] } | undefined = {
    top: 100,
    bottom: 100,
    visibleSequences: [],
  };
  const layouts: (() => void)[] = [];
  const runtime = {
    can: () => ({ ok: online }),
    sync: vi.fn(async () => {}),
    outbox: vi.fn(() => []),
    getSnapshot: () => ({ user: { id: "user" } }),
    command: vi.fn(async () => ({})),
  };
  const viewport = {
    scroll: vi.fn(),
    afterLayout: (cb: () => void) => layouts.push(cb),
    read: () => facts,
  };
  const input = {
    group: { id: "group", name: "G" } as CommunityConversation,
    state: {
      ...initialState("group"),
      readSeq: options.readSeq ?? 2,
      lastSeq: options.lastSeq ?? 10,
    },
    rows: [3, 4].map(
      (seq) =>
        ({
          scope: "conv:group",
          type: "post",
          id: `post${seq}`,
          rev: seq,
          deleted: false,
          data: post(seq),
        }) as StoredRow,
    ),
  };
  const model = new ConversationController(
    runtime as unknown as ConversationPort,
    input,
    viewport,
  );
  return {
    model,
    input,
    runtime,
    viewport,
    layouts,
    setOnline: (v: boolean) => (online = v),
    setFacts: (v: typeof facts) => (facts = v),
  };
}

describe("jumping to a quoted post", () => {
  it("scrolls straight to a post that is already loaded", async () => {
    const t = fixture();
    await t.model.jump("post3", 3);
    expect(t.viewport.scroll).toHaveBeenCalledWith("post3", "center");
    expect(loadReply).not.toHaveBeenCalled();
  });
  it("explains that an uncached quote cannot be fetched offline", async () => {
    const t = fixture({ online: false });
    await t.model.jump("old", 3);
    expect(t.model.getState().error).toContain("离线");
    expect(loadReply).not.toHaveBeenCalled();
  });
  it("scrolls after layout once the quoted post is fetched, and reports a vanished one", async () => {
    const t = fixture();
    vi.mocked(loadReply).mockResolvedValueOnce(post(1));
    await t.model.jump("post1", 3);
    expect(t.viewport.scroll).not.toHaveBeenCalled();
    t.layouts.shift()!();
    expect(t.viewport.scroll).toHaveBeenCalledWith("post1", "center");
    expect(t.model.getState().loading).toBe(false);
    vi.mocked(loadReply).mockResolvedValueOnce(undefined);
    await t.model.jump("gone", 3);
    expect(t.model.getState().error).toBe("引用的消息已不可用");
  });
  it("drops the scroll when the conversation closes mid-fetch, and surfaces failures", async () => {
    const t = fixture();
    let resolve!: (p: ChatPost) => void;
    vi.mocked(loadReply).mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const pending = t.model.jump("post1", 3);
    t.model.dispose();
    resolve(post(1));
    await pending;
    expect(t.layouts).toHaveLength(0);
    const f = fixture();
    vi.mocked(loadReply).mockRejectedValueOnce(new Error("boom"));
    await f.model.jump("x", 3);
    expect(f.model.getState()).toMatchObject({ error: "boom", loading: false });
  });
});

describe("boundaries and read marker", () => {
  async function ready(t: ReturnType<typeof fixture>) {
    vi.mocked(page).mockResolvedValueOnce(win([3, 4]));
    t.model.update(t.input);
    await settle();
    t.layouts.shift()!();
  }
  it("loads newer posts at the bottom edge but never past the latest sequence", async () => {
    const t = fixture();
    await ready(t);
    vi.mocked(page).mockResolvedValue(win([5, 6]));
    t.setFacts({ top: 500, bottom: 10, visibleSequences: [4] });
    t.model.boundary();
    expect(page).toHaveBeenLastCalledWith(t.runtime, "group", "after", 4);
    await settle();
    // already holding the latest post: nothing more to fetch
    const full = { ...t.input, state: { ...t.input.state, lastSeq: 4 } };
    t.model.bind(full);
    vi.mocked(page).mockClear();
    t.model.boundary();
    expect(page).not.toHaveBeenCalled();
  });
  it("does not page while offline, while loading or when the first post is already shown", async () => {
    const t = fixture();
    await ready(t);
    t.setOnline(false);
    t.setFacts({ top: 0, bottom: 100, visibleSequences: [3] });
    vi.mocked(page).mockClear();
    t.model.boundary();
    expect(page).not.toHaveBeenCalled();
    t.setOnline(true);
    const first = fixture();
    vi.mocked(page).mockResolvedValueOnce({ ...win([1, 2]), hasBefore: false });
    first.input.rows = [1, 2].map(
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
    first.model.update(first.input);
    await settle();
    first.layouts.shift()?.();
    vi.mocked(page).mockClear();
    first.setFacts({ top: 0, bottom: 100, visibleSequences: [1] });
    first.model.boundary();
    expect(page).not.toHaveBeenCalled();
  });
  it("tracks whether the viewport is away from the bottom and reports read failures", async () => {
    const t = fixture();
    await ready(t);
    t.setFacts({ top: 100, bottom: 49, visibleSequences: [4] });
    t.model.visibleRead();
    expect(t.model.getState().awayFromBottom).toBe(true);
    t.setFacts({ top: 100, bottom: 48, visibleSequences: [4] });
    t.model.visibleRead();
    expect(t.model.getState().awayFromBottom).toBe(false);
    t.runtime.command.mockRejectedValueOnce(new Error("offline"));
    t.setFacts({ top: 100, bottom: 0, visibleSequences: [9] });
    t.model.visibleRead();
    await settle();
    expect(t.model.getState()).toMatchObject({ error: "offline", read: 9 });
    t.setFacts(undefined);
    t.model.visibleRead();
  });
  it("ignores layout facts until the first window is positioned", () => {
    const t = fixture();
    t.setFacts({ top: 0, bottom: 0, visibleSequences: [9] });
    t.model.visibleRead();
    expect(t.runtime.command).not.toHaveBeenCalled();
  });
});

describe("offline entry and recovery", () => {
  it("opens an uncached-network conversation at the first unread cached post", () => {
    const t = fixture({ online: false });
    t.model.update(t.input);
    expect(t.viewport.scroll).toHaveBeenCalledWith("post3", "start");
    expect(page).not.toHaveBeenCalled();
  });
  it("opens at the newest cached post when everything cached was already read", () => {
    const t = fixture({ online: false, readSeq: 9 });
    t.model.update(t.input);
    expect(t.viewport.scroll).toHaveBeenCalledWith("post4", "end");
  });
  it("starts the network initialisation when connectivity returns and surfaces a failed sync", async () => {
    const t = fixture({ online: false });
    t.model.update(t.input);
    t.setOnline(true);
    t.runtime.sync.mockRejectedValueOnce(new Error("sync down"));
    t.model.update(t.input);
    await settle();
    expect(t.model.getState()).toMatchObject({
      error: "sync down",
      loading: false,
    });
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
