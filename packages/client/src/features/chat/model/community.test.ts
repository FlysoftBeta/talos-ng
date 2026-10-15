// @vitest-environment node
import { expect, it, vi } from "vitest";
import { contract } from "@talos/contract";
import type { CommunityConversation } from "@talos/contract";
import {
  GroupBrowserController,
  CreateGroupController,
  MembersController,
} from "./community.ts";
import type { CommunityPort } from "./ports.ts";
function fixture() {
  const events: unknown[] = [];
  const runtime = {
    can: () => ({ ok: true }),
    command: vi.fn(async (method: unknown, args: unknown) => {
      events.push([method, args]);
      return { id: "joined" };
    }),
    sync: vi.fn(async () => {
      events.push("sync");
    }),
    dispatch: vi.fn((intent: unknown) => {
      events.push(intent);
    }),
    getSnapshot: () => ({ user: { id: "me" } }),
  };
  const close = vi.fn(() => {
    events.push("close");
  });
  return { runtime, port: runtime as unknown as CommunityPort, close, events };
}
it("joins a password-protected child through its parent and syncs before opening", async () => {
  const { runtime, port, close, events } = fixture(),
    parent = { id: "parent" } as CommunityConversation;
  const model = new GroupBrowserController(port, {
    open: true,
    parent,
    onClose: close,
  });
  model.select({ id: "child" } as CommunityConversation);
  model.setPassword("secret");
  await model.join();
  expect(runtime.command).toHaveBeenCalledWith(contract.community.group.join, {
    group: "child",
    source: { type: "group", group: "parent" },
    password: "secret",
  });
  expect(events.slice(1)).toEqual([
    "sync",
    { type: "openConversation", id: "joined" },
    "close",
  ]);
});
it("creates a group with field policy and leaves failures available for retry", async () => {
  const { runtime, port, close } = fixture(),
    model = new CreateGroupController(port, {
      open: true,
      groups: [],
      onClose: close,
    });
  model.setName("Group");
  model.setHidden(true);
  model.setParent("parent");
  model.setAdminOnly(true);
  runtime.command.mockRejectedValueOnce(new Error("offline"));
  await model.create();
  expect(close).not.toHaveBeenCalled();
  expect(model.getState()).toMatchObject({ name: "Group", busy: false });
  await model.create();
  expect(runtime.command).toHaveBeenLastCalledWith(
    contract.community.group.create,
    {
      name: "Group",
      parent: "parent",
      discoverable: true,
      membersHidden: true,
      adminOnly: true,
    },
  );
  expect(close).toHaveBeenCalledOnce();
});
it("changes member visibility only after success, opens DMs after sync, and navigates back after leave", async () => {
  const { runtime, port, close, events } = fixture(),
    model = new MembersController(port, {
      group: { id: "group" } as CommunityConversation,
      open: true,
      cached: [],
      onClose: close,
    });
  runtime.command.mockRejectedValueOnce(new Error("denied"));
  await model.hide(true);
  expect(model.getState().selfHidden).toBe(false);
  await model.hide(true);
  expect(model.getState().selfHidden).toBe(true);
  events.length = 0;
  await model.dm("peer");
  expect(events).toEqual([
    [contract.community.dm.open, { user: "peer", group: "group" }],
    "sync",
    { type: "openConversation", id: "joined" },
    "close",
  ]);
  events.length = 0;
  await model.leaveGroup();
  expect(events).toEqual([
    [contract.community.group.leave, { group: "group" }],
    "close",
    { type: "back" },
  ]);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

it("keeps only the newest group search when answers arrive out of order", async () => {
  const { runtime, port, close } = fixture();
  const first = deferred<CommunityConversation[]>();
  const second = deferred<CommunityConversation[]>();
  runtime.command.mockReturnValueOnce(first.promise as never);
  runtime.command.mockReturnValueOnce(second.promise as never);
  const model = new GroupBrowserController(port, {
    open: true,
    onClose: close,
  });
  model.setQuery("a");
  const slow = model.search();
  model.setQuery("ab");
  const fast = model.search();
  second.resolve([{ id: "new" } as CommunityConversation]);
  await fast;
  first.resolve([{ id: "stale" } as CommunityConversation]);
  await slow;
  expect(model.getState().groups).toEqual([{ id: "new" }]);
  expect(model.getState().busy).toBe(false);
});

it("drops a search result after the browser closes and reopens on another parent", async () => {
  const { runtime, port, close } = fixture();
  const pending = deferred<CommunityConversation[]>();
  runtime.command.mockReturnValueOnce(pending.promise as never);
  const model = new GroupBrowserController(port, {
    open: true,
    parent: { id: "p1" } as CommunityConversation,
    onClose: close,
  });
  const stop = model.start();
  stop();
  pending.resolve([{ id: "late" } as CommunityConversation]);
  await Promise.resolve();
  await Promise.resolve();
  expect(model.getState().groups).toBeUndefined();
});

it("shows a queued (offline) answer as an error instead of joining", async () => {
  const { runtime, port, close, events } = fixture();
  runtime.command.mockResolvedValueOnce({ queued: true } as never);
  const model = new GroupBrowserController(port, {
    open: true,
    onClose: close,
  });
  model.select({ id: "g" } as CommunityConversation);
  await model.join();
  expect(model.getState()).toMatchObject({
    busy: false,
    error: expect.any(String),
  });
  expect(model.getState().error).not.toBe("");
  expect(close).not.toHaveBeenCalled();
  expect(events).not.toContain("sync");
});

it("does not join without a selection and omits an empty password", async () => {
  const { runtime, port, close } = fixture();
  const model = new GroupBrowserController(port, {
    open: true,
    onClose: close,
  });
  await model.join();
  expect(runtime.command).not.toHaveBeenCalled();
  model.select({ id: "g" } as CommunityConversation);
  await model.join();
  expect(runtime.command).toHaveBeenCalledWith(contract.community.group.join, {
    group: "g",
    source: { type: "search" },
  });
});

it("omits optional create fields, blocks an empty name and exposes only groups as parents", () => {
  const { port, close } = fixture();
  const model = new CreateGroupController(port, {
    open: true,
    groups: [
      { id: "g", kind: "group" } as CommunityConversation,
      { id: "d", kind: "dm" } as CommunityConversation,
    ],
    onClose: close,
  });
  expect(model.presentation().createDisabled).toBe(true);
  expect(model.presentation().groups.map((g) => g.id)).toEqual(["g"]);
  model.setName("   ");
  expect(model.presentation().createDisabled).toBe(true);
});

it("ignores a member list that resolves after the sheet closed", async () => {
  const { runtime, port, close } = fixture();
  const pending = deferred<unknown>();
  runtime.command.mockReturnValueOnce(pending.promise as never);
  const input = {
    group: { id: "group" } as CommunityConversation,
    open: true,
    cached: [{ user: "cached" }] as never,
    onClose: close,
  };
  const model = new MembersController(port, input);
  model.update(input);
  model.update({ ...input, open: false });
  pending.resolve({
    members: [{ user: "late" }],
    hidden: true,
    self: { hidden: true },
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(model.getState()).toMatchObject({ hidden: false, selfHidden: false });
  expect(model.getState().members).toEqual([{ user: "cached" }]);
});

it("reports a member-list failure and clears it when the next action starts", async () => {
  const { runtime, port, close } = fixture();
  runtime.command.mockRejectedValueOnce(new Error("offline"));
  const input = {
    group: { id: "g" } as CommunityConversation,
    open: true,
    cached: [],
    onClose: close,
  };
  const model = new MembersController(port, input);
  model.update(input);
  await vi.waitFor(() => expect(model.getState().error).not.toBe(""));
  await model.hide(false);
  expect(model.getState().error).toBe("");
});

it("marks the signed-in member and hides leave for no-leave groups", () => {
  const { port, close } = fixture();
  const model = new MembersController(port, {
    group: { id: "g", noLeave: true } as CommunityConversation,
    open: true,
    cached: [{ user: "me" }, { user: "other" }] as never,
    onClose: close,
  });
  const view = model.presentation();
  expect(view.canLeave).toBe(false);
  expect(view.members.map((m) => m.self)).toEqual([true, false]);
});
