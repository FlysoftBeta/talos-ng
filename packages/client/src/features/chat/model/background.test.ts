// @vitest-environment node
import { expect, it, vi } from "vitest";

import type { BackgroundPort } from "./ports.ts";
import type { StoredRow } from "../../../core/data/db.ts";
import { BackgroundController } from "./background.ts";
import { initialState } from "./module.ts";
function rows(
  seq: number,
  author = "00000000000000000000000002",
  mute = false,
): StoredRow[] {
  const post = {
    id: `0000000000000000000000000${seq}`,
    conversation: "00000000000000000000000001",
    seq,
    author,
    preview: "message",
    rev: seq,
    authorName: "Peer",
    kind: "text" as const,
    bodyLength: 7,
    replyTo: null,
    created: 1000,
    edited: null,
    deletedAt: null,
    image: null,
    sticker: null,
  };
  const state = initialState("00000000000000000000000001");
  state.lastSeq = seq;
  state.lastPost = post;
  state.mute.v = mute;
  return [
    {
      scope: "me:me",
      id: "00000000000000000000000001",
      type: "chatState",
      rev: seq,
      deleted: false,
      data: state,
    },
  ];
}
it("suppresses initial history, own/muted/active/DND posts, deduplicates, and cancels banner expiry", () => {
  let dnd = false,
    area = "library";
  const timers = new Map<number, () => void>();
  let id = 0;
  const runtime = {
    setting: () => dnd,
    getSnapshot: () => ({
      user: { id: "00000000000000000000000003" },
      nav: {
        area,
        areas: {
          chat: {
            stack: [{ kind: "conversation", id: "00000000000000000000000001" }],
          },
        },
      },
    }),
    delay: (callback: () => void) => {
      timers.set(++id, callback);
      return id;
    },
    clearDelay: (id: number) => timers.delete(id),
    can: () => ({ ok: true }),
    dispatch: vi.fn(),
  };
  const model = new BackgroundController(runtime as unknown as BackgroundPort);
  model.update(rows(1));
  expect(model.getState().banner).toBeUndefined();
  model.update(rows(2, "00000000000000000000000003"));
  model.update(rows(3, "00000000000000000000000002", true));
  expect(model.getState().banner).toBeUndefined();
  area = "chat";
  model.update(rows(4));
  expect(model.getState().banner).toBeUndefined();
  area = "library";
  dnd = true;
  model.update(rows(5));
  expect(model.getState().banner).toBeUndefined();
  dnd = false;
  model.update(rows(6));
  expect(model.getState().banner?.post.id).toBe("00000000000000000000000006");
  model.dismiss();
  model.update(rows(5));
  model.update(rows(6));
  expect(model.getState().banner).toBeUndefined();
  model.update(rows(7));
  expect(timers.size).toBe(1);
  model.open();
  expect(runtime.dispatch).toHaveBeenCalledWith({
    type: "openConversation",
    id: "00000000000000000000000001",
  });
  expect(model.getState().banner).toBeUndefined();
  model.dispose();
  expect(timers.size).toBe(0);
});
