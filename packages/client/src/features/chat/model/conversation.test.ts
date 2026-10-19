// @vitest-environment node
import { expect, it, vi } from "vitest";
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
  rev: 10,
});
function fixture() {
  vi.resetAllMocks();
  vi.mocked(page).mockResolvedValue({ ...result([]), hasBefore: false });
  const runtime = {
    can: () => ({ ok: true }),
    gate: () => ({ ok: true }),
    time: () => 1000,
    sync: vi.fn(async () => {}),
    outbox: vi.fn<() => OutboxItem[]>(() => []),
    getSnapshot: () => ({
      user: { id: "user" },
      status: { connection: "syncing" },
    }),
    command: vi.fn(async () => ({})),
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
  );
  return { runtime, input, model };
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
it("drops a pending open and stale full-text completions on close", async () => {
  const { model, input } = fixture(),
    pending = deferred<ReturnType<typeof result>>();
  vi.mocked(page).mockReturnValueOnce(pending.promise);
  // Nothing cached: opening waits for the server.
  model.update({ ...input, rows: [] });
  await settle();
  model.dispose();
  pending.resolve(result([3, 4]));
  await settle();
  expect(model.history.getSnapshot().count).toBe(0);
  const body = deferred<string>();
  vi.mocked(fullBody).mockReturnValueOnce(body.promise);
  const reading = model.view(post(3), false);
  model.setTextView(undefined);
  body.resolve("late");
  await reading;
  expect(model.getState().textView).toBeUndefined();
});

it("replaces a pending projection when its failed outbox notification arrives before repository rows", async () => {
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
  model.update({
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
  await settle();
  const items = model.history.getSnapshot().items;
  expect(items).toHaveLength(1);
  expect(items[0]!.item.post).toMatchObject({
    id,
    failed: id,
    preview: "retry",
  });
});
