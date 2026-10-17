// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatPost, ChatState } from "@talos/contract";
import { initialState } from "./module.ts";
import { RetentionController } from "./retention.ts";
import type { RetentionPort } from "./ports.ts";
import { fileBytes, fullBody, page } from "./commands.ts";
const harness = vi.hoisted(() => ({
  runtime: {} as Record<string, unknown>,
  snapshot: {} as Record<string, unknown>,
}));
vi.mock("./commands.ts", () => ({
  page: vi.fn(),
  fullBody: vi.fn(),
  fileBytes: vi.fn(),
  message: () => "下载失败",
}));
const id = "00000000000000000000000001";
const now = 1700000000000;
function post(seq: number, age: number): ChatPost {
  return {
    id: `00000000000000000000${String(seq).padStart(6, "0")}`,
    conversation: id,
    seq,
    rev: seq,
    author: id,
    authorName: "同学",
    kind: "text",
    preview: "正文",
    bodyLength: 2,
    replyTo: null,
    created: now - age,
    edited: null,
    deletedAt: null,
    image: null,
    sticker: null,
  };
}
function result(posts: ChatPost[], hasBefore = false) {
  return {
    posts,
    first: posts[0]?.seq ?? 0,
    last: posts[posts.length - 1]?.seq ?? 0,
    latest: 3,
    hasBefore,
    hasAfter: false,
    rev: 3,
  };
}
describe("rolling retained conversations", () => {
  let model: RetentionController;
  async function update(state: ChatState) {
    model.update([state], [], []);
    for (let i = 0; i < 30; i++) await Promise.resolve();
  }
  let state: ChatState;
  beforeEach(() => {
    vi.clearAllMocks();
    harness.snapshot = {
      user: { id },
      gate: "app",
      status: { connection: "connected" },
    };
    harness.runtime = {
      getSnapshot: () => harness.snapshot,
      time: () => now,
      can: () => ({ ok: true }),
      hasScope: () => true,
      delay: vi.fn(() => 1),
      clearDelay: vi.fn(),
      releaseFiles: vi.fn(async () => undefined),
      setLocal: vi.fn(async () => undefined),
      setTransfer: vi.fn(),
    };
    model = new RetentionController(
      harness.runtime as unknown as RetentionPort,
    );
    state = {
      ...initialState(id),
      lastSeq: 3,
      retention: { v: "week", t: { ms: 1, counter: 0 }, op: id },
    };
  });
  afterEach(() => model.dispose());
  it("keeps a policy selected long ago active and stops at the sent-time cutoff", async () => {
    const recent = post(3, 1000),
      older = post(2, 600000000),
      expired = post(1, 700000000);
    vi.mocked(page)
      .mockResolvedValueOnce(result([recent], true))
      .mockResolvedValueOnce(result([expired, older]));
    await update(state);
    expect(page).toHaveBeenNthCalledWith(
      1,
      harness.runtime,
      id,
      "latest",
      undefined,
    );
    expect(page).toHaveBeenNthCalledWith(2, harness.runtime, id, "before", 3);
    expect(fullBody).toHaveBeenCalledTimes(2);
    expect(fullBody).toHaveBeenCalledWith(harness.runtime, recent);
    expect(fullBody).not.toHaveBeenCalledWith(harness.runtime, expired);
    expect(harness.runtime.setLocal).toHaveBeenCalledWith(
      `conv:${id}:retention`,
      { op: id, cutoff: now - 604800000 },
    );
    expect(harness.runtime.setTransfer).toHaveBeenLastCalledWith(
      `conv:${id}:retained`,
      expect.objectContaining({ progress: 1 }),
    );
  });
  it("downloads both thumbnail and original plus stickers under the revocable owner", async () => {
    const file = {
      rid: "a".repeat(64),
      size: 1,
      mime: "image/png",
      width: 1,
      height: 1,
    };
    const image = {
      ...post(2, 100),
      kind: "image" as const,
      image: { thumbnail: file, original: { ...file, rid: "b".repeat(64) } },
    };
    const sticker = {
      ...post(3, 50),
      kind: "sticker" as const,
      sticker: { id: "one", pack: "pack", name: "贴纸", file },
    };
    vi.mocked(page).mockResolvedValue(result([image, sticker]));
    await update(state);
    expect(fileBytes).toHaveBeenCalledTimes(3);
    expect(fileBytes).toHaveBeenCalledWith(
      harness.runtime,
      image.image.original,
      id,
      `conv:${id}:retained`,
    );
    expect(fileBytes).toHaveBeenCalledWith(
      harness.runtime,
      file,
      undefined,
      `conv:${id}:retained`,
    );
    expect(fullBody).not.toHaveBeenCalled();
  });
  it("reports a failure once without an effect retry loop", async () => {
    vi.mocked(page).mockRejectedValue(new Error("network"));
    await update(state);
    expect(page).toHaveBeenCalledTimes(1);
    expect(harness.runtime.setTransfer).toHaveBeenLastCalledWith(
      `conv:${id}:retained`,
      expect.objectContaining({ error: "下载失败" }),
    );
  });
  it("releases retention when auto is selected without fetching history", async () => {
    await update(initialState(id));
    expect(harness.runtime.releaseFiles).toHaveBeenCalledWith(
      `conv:${id}:retained`,
    );
    expect(page).not.toHaveBeenCalled();
  });
  it("stops an in-flight retention pass when its scope is revoked or the controller closes", async () => {
    let resolve!: (value: ReturnType<typeof result>) => void;
    vi.mocked(page).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await update(state);
    harness.runtime.hasScope = () => false;
    model.dispose();
    resolve(result([post(3, 100)]));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(fullBody).not.toHaveBeenCalled();
    expect(page).toHaveBeenCalledTimes(1);
    await update(state);
    expect(page).toHaveBeenCalledTimes(1);
  });
});
