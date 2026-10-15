// @vitest-environment node
import { expect, it, vi } from "vitest";
import { contract } from "@talos/contract";
import type { OutboxItem } from "@talos/sync";
import type { ChatPost, CommunityConversation } from "@talos/contract";
import type { StoredRow } from "../../../core/data/db.ts";
import { ConversationController } from "./conversation.ts";
import { initialState } from "./module.ts";
import type { ConversationPort } from "./ports.ts";
import { page, fullBody } from "./commands.ts";
vi.mock("./commands.ts", () => ({
  page: vi.fn(),
  fullBody: vi.fn(),
  message: (error: Error) => error.message,
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
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
const result = (seqs: number[], hasAfter = false) => ({
  posts: seqs.map(post),
  first: seqs[0] ?? 0,
  last: seqs[seqs.length - 1] ?? 0,
  latest: 10,
  hasBefore: true,
  hasAfter,
});
function fixture() {
  vi.clearAllMocks();
  const runtime = {
    can: () => ({ ok: true }),
    gate: () => ({ ok: true }),
    time: () => 1000,
    sync: vi.fn(async () => {}),
    outbox: vi.fn<() => OutboxItem[]>(() => []),
    getSnapshot: () => ({ user: { id: "user" } }),
    command: vi.fn(async () => ({})),
  };
  let facts = { top: 100, bottom: 100, visibleSequences: [3, 4] };
  const layouts: (() => void)[] = [];
  const viewport = {
    scroll: vi.fn(),
    afterLayout: (callback: () => void) => layouts.push(callback),
    read: () => facts,
  };
  const input = {
    group: { id: "group", name: "Group" } as CommunityConversation,
    state: { ...initialState("group"), readSeq: 2, lastSeq: 10 },
    rows: [3, 4].map(
      (seq) =>
        ({
          scope: "conv:group",
          type: "post",
          id: post(seq).id,
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
    runtime,
    input,
    model,
    viewport,
    layouts,
    facts: (value: typeof facts) => {
      facts = value;
    },
  };
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
it("loads unread and latest windows, seeks unread only after layout, and advances only fully visible read edges", async () => {
  const { model, input, runtime, viewport, layouts, facts } = fixture();
  vi.mocked(page)
    .mockResolvedValueOnce(result([3, 4], true))
    .mockResolvedValueOnce(result([9, 10]));
  model.update(input);
  expect(runtime.command).not.toHaveBeenCalled();
  await settle();
  expect(page).toHaveBeenNthCalledWith(1, runtime, "group", "around", 3);
  expect(page).toHaveBeenNthCalledWith(2, runtime, "group", "latest");
  expect(viewport.scroll).not.toHaveBeenCalled();
  layouts.shift()!();
  expect(viewport.scroll).toHaveBeenCalledWith("post3", "start");
  expect(runtime.command).toHaveBeenLastCalledWith(contract.chat.state.read, {
    conversation: "group",
    seq: 4,
  });
  facts({ top: 100, bottom: 0, visibleSequences: [2, 3] });
  model.visibleRead();
  expect(runtime.command).toHaveBeenCalledTimes(1);
  facts({ top: 100, bottom: 0, visibleSequences: [9, 10] });
  model.visibleRead();
  expect(runtime.command).toHaveBeenLastCalledWith(contract.chat.state.read, {
    conversation: "group",
    seq: 10,
  });
});
it("pages a boundary once while loading and fetches newly arriving posts without changing the unread anchor", async () => {
  const { model, input, runtime, layouts, facts } = fixture();
  vi.mocked(page).mockResolvedValueOnce(result([3, 4]));
  model.update(input);
  await settle();
  layouts.shift()!();
  const pending = deferred<ReturnType<typeof result>>();
  vi.mocked(page).mockReturnValueOnce(pending.promise);
  facts({ top: 0, bottom: 100, visibleSequences: [3] });
  model.boundary();
  model.boundary();
  expect(page).toHaveBeenCalledTimes(2);
  expect(page).toHaveBeenLastCalledWith(runtime, "group", "before", 3);
  pending.resolve(result([1, 2]));
  await settle();
  vi.mocked(page).mockResolvedValueOnce(result([10, 11]));
  model.update({ ...input, state: { ...input.state, lastSeq: 11 } });
  await settle();
  expect(page).toHaveBeenLastCalledWith(runtime, "group", "latest", undefined);
  expect(model.initial).toBe(2);
});
it("cancels stale navigation/layout and full-text completions on close", async () => {
  const { model, input, viewport, layouts } = fixture(),
    pending = deferred<ReturnType<typeof result>>();
  vi.mocked(page).mockReturnValueOnce(pending.promise);
  model.update(input);
  await settle();
  model.dispose();
  pending.resolve(result([3, 4]));
  await settle();
  layouts.forEach((callback) => callback());
  expect(viewport.scroll).not.toHaveBeenCalled();
  const body = deferred<string>();
  vi.mocked(fullBody).mockReturnValueOnce(body.promise);
  const reading = model.view(post(3), false);
  model.setTextView(undefined);
  body.resolve("late");
  await reading;
  expect(model.getState().textView).toBeUndefined();
});

it("replaces a pending projection when its failed outbox notification arrives before repository rows", () => {
  const { model, input, runtime } = fixture();
  const id = "00000000000000000000000001",
    group = "00000000000000000000000002";
  runtime.outbox.mockReturnValue([
    {
      op: id,
      method: "chat.post.send",
      state: "failed",
      attempts: 1,
      createdAt: 1000,
      args: { id, conversation: group, kind: "text", text: "retry" },
    },
  ]);
  model.bind({
    ...input,
    group: { ...input.group, id: group },
    rows: [
      {
        scope: `conv:${group}`,
        id,
        type: "post",
        rev: 0,
        deleted: false,
        data: { ...post(1), id, conversation: group, pending: true },
      },
    ],
  });
  const items = model.presentation().items;
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ id, failed: id, preview: "retry" });
});
