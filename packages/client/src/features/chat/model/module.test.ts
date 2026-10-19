import { describe, expect, it } from "vitest";
import {
  chatModule,
  initialState,
  posts,
  sortedConversations,
  states,
  unreadCount,
} from "./module.ts";
import { ModuleRegistry } from "../../../core/data/modules.ts";
import type { StoredRow } from "../../../core/data/db.ts";
import type { OutboxItem } from "@talos/sync";
import type { CommunityConversation } from "@talos/contract";
import { retentionCutoff } from "./retention.ts";
const user = "00000000000000000000000001",
  conversation = "00000000000000000000000002",
  op = "00000000000000000000000003";
const registry = new ModuleRegistry([chatModule]);
function queued(method: string, args: unknown, id = op): OutboxItem {
  return {
    op: id,
    method,
    args,
    createdAt: 100,
    state: "pending",
    attempts: 0,
  };
}
function stateRows(): StoredRow[] {
  return [
    {
      scope: `me:${user}`,
      type: "chatState",
      id: conversation,
      rev: 5,
      deleted: false,
      data: initialState(conversation),
    },
  ];
}
function set(key: string, v: string | boolean, ms = 10, id = op): OutboxItem {
  return queued(
    "chat.state.set",
    { conversation, key, value: { v, t: { ms, counter: 0 }, op: id } },
    id,
  );
}
describe("chat durable reducers", () => {
  it("keeps all mutable input untouched", () => {
    const rows = stateRows();
    const copy = JSON.stringify(rows);
    const projected = registry.project(
      rows,
      [set("pin", true), set("draft", "草稿")],
      user,
    );
    expect(JSON.stringify(rows)).toBe(copy);
    expect(states(projected)[0]?.pin.v).toBe(true);
    expect(states(projected)[0]?.draft.v).toBe("草稿");
  });
  it("uses timestamp then op id for equal-time pin convergence", () => {
    const older = set("pin", false, 10, op);
    const newer = set("pin", true, 10, "00000000000000000000000004");
    expect(
      states(registry.project(stateRows(), [newer, older], user))[0]?.pin.v,
    ).toBe(true);
  });
  it("merges read cursors monotonically across random delivery orders", () => {
    for (let seed = 0; seed < 50; seed++) {
      const values = Array.from(
        { length: 40 },
        (_, i) => (i * 37 + seed * 13) % 173,
      );
      const intents = values.map((seq) =>
        queued("chat.state.read", { conversation, seq }),
      );
      expect(
        states(registry.project(stateRows(), intents, user))[0]?.readSeq,
      ).toBe(Math.max(...values));
    }
  });
  it("does not project rejected state changes", () => {
    expect(
      states(
        registry.project(
          stateRows(),
          [{ ...set("mute", true), state: "failed" }],
          user,
        ),
      )[0]?.mute.v,
    ).toBe(false);
  });
  it("preserves earlier state for malformed inputs", () => {
    const rows = stateRows();
    expect(
      registry.project(
        rows,
        [queued("chat.state.read", { conversation, seq: -1 })],
        user,
      ),
    ).toBe(rows);
    expect(
      registry.project(rows, [set("retention", "forever")], user)[0]?.data,
    ).toEqual(rows[0]?.data);
  });
  it("creates consecutive pending immutable facts and does not duplicate authoritative ids", () => {
    const first = queued("chat.post.send", {
      id: op,
      conversation,
      kind: "text",
      text: "第一条",
    });
    const second = queued(
      "chat.post.send",
      {
        id: "00000000000000000000000004",
        conversation,
        kind: "text",
        text: "第二条",
        replyTo: op,
      },
      "00000000000000000000000004",
    );
    const projected = registry.project(stateRows(), [first, second], user);
    expect(posts(projected, conversation).map((post) => post.seq)).toEqual([
      1, 2,
    ]);
    expect(posts(projected, conversation)[1]?.replyTo).toBe(op);
    expect(posts(projected, conversation)[0]?.pending).toBe(op);
    // The sender's own pending posts never count as unread.
    expect(states(projected)[0]?.readSeq).toBe(2);
    expect(
      posts(registry.project(projected, [first], user), conversation),
    ).toHaveLength(2);
  });
  it("rolls rejected send back without inventing successful facts", () => {
    const intent = {
      ...queued("chat.post.send", {
        id: op,
        conversation,
        kind: "text",
        text: "被拒绝",
      }),
      state: "failed" as const,
    };
    expect(
      posts(registry.project(stateRows(), [intent], user), conversation),
    ).toHaveLength(0);
  });
  it("does not replace a tombstone with pending retry", () => {
    const rows = [
      ...stateRows(),
      {
        scope: `conv:${conversation}`,
        type: "post",
        id: op,
        rev: 20,
        deleted: true,
        data: null,
      },
    ];
    const result = registry.project(
      rows,
      [
        queued("chat.post.send", {
          id: op,
          conversation,
          kind: "text",
          text: "再次发送",
        }),
      ],
      user,
    );
    expect(posts(result, conversation)).toHaveLength(0);
  });
  it("acks announcements by maximum revision", () => {
    const intents = [
      queued("chat.announcement.ack", { revision: 8 }),
      queued("chat.announcement.ack", { revision: 2 }),
    ];
    expect(registry.project([], intents, user)[0]?.data).toEqual({
      id: "current",
      revision: 8,
    });
  });
  it("keeps giant draft reference tied to the winning value", () => {
    const newer = {
      ...set("draft", "", 20),
      args: {
        conversation,
        key: "draft",
        value: { v: "", t: { ms: 20, counter: 0 }, op },
        textId: "00000000000000000000000009",
      },
    };
    expect(
      states(
        registry.project(stateRows(), [newer, set("draft", "old", 10)], user),
      )[0]?.draftTextId,
    ).toBe("00000000000000000000000009");
  });
  it.each(["pin", "mute", "draft", "retention"])(
    "registers offline %s changes",
    (key) => {
      expect(registry.supports("chat.state.set")).toBe(true);
      const value =
        key === "draft" ? "草稿" : key === "retention" ? "week" : true;
      expect(
        states(registry.project([], [set(key, value)], user))[0],
      ).toBeDefined();
    },
  );
});
describe("conversation view models", () => {
  const group = (
    id: string,
    name: string,
    created: number,
  ): CommunityConversation => ({
    id,
    kind: "group",
    type: "normal",
    name,
    created,
    rev: 1,
    handle: "",
    parent: null,
    owner: null,
    discoverable: true,
    membersHidden: false,
    adminOnly: false,
    noLeave: false,
    passwordRequired: false,
  });
  it("orders pins, activity, then name without mutating groups", () => {
    const a = group(conversation, "甲", 1),
      b = group(op, "乙", 2),
      c = group("00000000000000000000000004", "丙", 9);
    const values = [
      { ...initialState(a.id), pin: { ...initialState(a.id).pin, v: true } },
    ];
    const groups = [c, b, a];
    expect(sortedConversations(groups, values).map((g) => g.id)).toEqual([
      a.id,
      c.id,
      b.id,
    ]);
    expect(groups[0]).toBe(c);
  });
  it("counts unread only in visible, unmuted conversations and never negative", () => {
    const ids = ["00000000000000000000000011", "00000000000000000000000012"],
      left = "00000000000000000000000013",
      row = (type: string, id: string, data: unknown): StoredRow => ({
        scope: type === "chatState" ? `me:${user}` : `conv:${id}`,
        type,
        id,
        rev: 1,
        deleted: false,
        data,
      }),
      state = (id: string, readSeq: number, mute = false) => {
        const base = initialState(id);
        return row("chatState", id, {
          ...base,
          lastSeq: 10,
          readSeq,
          mute: { ...base.mute, v: mute },
        });
      },
      muted = "00000000000000000000000014";
    const rows = [
      ...[...ids, muted].map((id) =>
        row("communityConversation", id, group(id, id, 1)),
      ),
      state(ids[0]!, 3),
      state(ids[1]!, 20),
      state(muted, 0, true),
      // A state whose conversation the user no longer sees.
      state(left, 0),
    ];
    expect(unreadCount(rows)).toBe(7);
  });
  it("computes rolling retention cutoffs from current time", () => {
    expect(retentionCutoff("auto", 100)).toBeUndefined();
    expect(retentionCutoff("week", 700000000)).toBe(95200000);
    expect(retentionCutoff("week", 100)).toBe(0);
    expect(retentionCutoff("half-year", 16000000000)).toBe(188800000);
  });
});
