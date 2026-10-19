// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { CommunityConversation } from "@talos/contract";
import { ComposerController } from "./composer.ts";
import { initialState } from "./module.ts";
import type { ComposerPort } from "./ports.ts";
import { draftBody, sendText, setState } from "./commands.ts";
import { uploadImage } from "./upload.ts";
vi.mock("./commands.ts", () => ({
  draftBody: vi.fn(),
  sendText: vi.fn(),
  setState: vi.fn(),
  message: (cause: Error) => cause.message,
}));
vi.mock("./upload.ts", () => ({ uploadImage: vi.fn() }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  vi.clearAllMocks();
  vi.mocked(setState).mockResolvedValue();
  const timers = new Map<number, () => void>();
  let id = 0,
    now = 100;
  const runtime = {
    time: () => now,
    delay: (callback: () => void) => {
      timers.set(++id, callback);
      return id;
    },
    clearDelay: (id: number) => timers.delete(id),
    can: () => ({ ok: true }),
    gate: () => ({ ok: true }),
    getSnapshot: () => ({ user: { id: "me", roles: [] } }),
  };
  const input = {
    group: { id: "group", owner: "me" } as CommunityConversation,
    state: initialState("group"),
    onReplyClear: vi.fn(),
  };
  const model = new ComposerController(
    runtime as unknown as ComposerPort,
    input,
  );
  model.start();
  return {
    model,
    input,
    runtime,
    timers,
    advance: (value: number) => {
      now = value;
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    },
  };
}
describe("composer draft and send lifecycle", () => {
  it("debounces edits and fences out-of-order save acknowledgments after send", async () => {
    const { model, advance } = fixture(),
      old = deferred<void>();
    vi.mocked(setState).mockImplementationOnce(() => old.promise);
    model.change("old");
    advance(500);
    model.change("new");
    await model.send();
    expect(sendText).toHaveBeenCalledWith(
      expect.anything(),
      "group",
      "new",
      undefined,
    );
    expect(model.getState().text).toBe("");
    old.resolve();
    await old.promise;
    await Promise.resolve();
    const count = vi.mocked(setState).mock.calls.length;
    model.dispose();
    expect(setState).toHaveBeenCalledTimes(count);
    expect(vi.mocked(setState).mock.calls.map((call) => call[3])).toEqual([
      "old",
      "",
    ]);
  });
  it("preserves the draft on failed send and prevents duplicate submissions", async () => {
    const { model, input } = fixture(),
      sending = deferred<string>();
    vi.mocked(sendText).mockImplementationOnce(() => sending.promise);
    model.change("draft");
    const first = model.send();
    await model.send();
    expect(sendText).toHaveBeenCalledTimes(1);
    sending.resolve("post");
    await first;
    model.change("retry");
    vi.mocked(sendText).mockRejectedValueOnce(new Error("offline"));
    await model.send();
    expect(model.getState()).toMatchObject({
      text: "retry",
      error: "offline",
      busy: false,
    });
    expect(input.onReplyClear).toHaveBeenCalledTimes(1);
  });
  it("ignores a delayed draft body after the draft reference changes or editor closes", async () => {
    const { model, input } = fixture(),
      first = deferred<string>(),
      second = deferred<string>();
    vi.mocked(draftBody)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    model.update({ ...input, state: { ...input.state, draftTextId: "first" } });
    model.update({
      ...input,
      state: { ...input.state, draftTextId: "second" },
    });
    first.resolve("old");
    await first.promise;
    expect(model.getState().text).toBe("");
    model.dispose();
    second.resolve("late");
    await second.promise;
    expect(model.getState().text).toBe("");
  });
  it("flushes unsaved text at unmount and refreshes a timed mute through the clock port", () => {
    const { model, input, advance, timers } = fixture();
    model.update({ ...input, state: { ...input.state, mutedUntil: 200 } });
    expect(model.restriction()).toContain("禁言至");
    advance(201);
    expect(model.restriction()).toBeUndefined();
    model.change("unsaved");
    model.dispose();
    expect(setState).toHaveBeenLastCalledWith(
      expect.anything(),
      "group",
      "draft",
      "unsaved",
    );
    expect(timers.size).toBe(0);
  });
  it("keeps the reply on upload failure and clears it only after success", async () => {
    const { model, input } = fixture();
    vi.mocked(uploadImage).mockRejectedValueOnce(new Error("interrupted"));
    await model.image({ size: 1, read: async () => new Uint8Array(1) });
    expect(model.getState()).toMatchObject({
      busy: false,
      progress: undefined,
      error: "interrupted",
    });
    expect(input.onReplyClear).not.toHaveBeenCalled();
    vi.mocked(uploadImage).mockResolvedValueOnce();
    await model.image({ size: 1, read: async () => new Uint8Array(1) });
    expect(input.onReplyClear).toHaveBeenCalledOnce();
  });
});
