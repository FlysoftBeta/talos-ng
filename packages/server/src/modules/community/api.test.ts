import { createUlid } from "@talos/base";
import type { CommunityConversation, User } from "@talos/contract";
import { createMemoryCarrierPair, LinkClient } from "@talos/link";
import { describe, expect, it, vi } from "vitest";
import { Db } from "../../kernel/persistence/db.ts";
import { Uow } from "../../kernel/persistence/uow.ts";
import { LinkHost } from "../../kernel/transport/link-host.ts";
import { CommunityService, registerCommunityApi } from "./index.ts";

describe("community memory-link API", () => {
  it("validates wire args, creates and joins with provenance, and rejects unauthenticated access", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const db = new Db();
    const uow = new Uow(db, { committed: () => {} });
    const id = createUlid();
    const users: User[] = [
      { id: id(), name: "甲", handle: "a", roles: [], features: [] },
      { id: id(), name: "乙", handle: "b", roles: [], features: [] },
    ];
    let actor: string | undefined = users[0]!.id;
    const service = new CommunityService({
      db,
      uow,
      user: (id) => users.find((user) => user.id === id),
      users: () => users,
    });
    const host = new LinkHost({
      db,
      uow,
      build: "test",
      authenticate: () => ({ user: actor }),
      reportIncident: () => "incident",
    });
    registerCommunityApi(host, service);
    const client = new LinkClient({
      hello: () => ({ v: 1, build: "test", device: null, lang: "zh-CN" }),
      connect: async () => {
        const pair = createMemoryCarrierPair();
        host.link.accept(pair.b, {});
        return pair.a;
      },
    });
    try {
      client.start();
      await vi.advanceTimersByTimeAsync(1);
      const invalid = expect(
        client.call("community.group.create", { name: "" }),
      ).rejects.toMatchObject({ code: "E_INVALID" });
      await vi.advanceTimersByTimeAsync(1);
      await invalid;
      const created = client.call("community.group.create", {
        name: "线上的群",
        discoverable: true,
      });
      await vi.advanceTimersByTimeAsync(1);
      const group = (await created).data as CommunityConversation;
      actor = users[1]!.id;
      const joined = client.call("community.group.join", {
        group: group.id,
        source: { type: "search" },
      });
      await vi.advanceTimersByTimeAsync(1);
      expect((await joined).data).toMatchObject({ id: group.id });
      const dm = client.call("community.dm.open", {
        user: users[0]!.id,
        group: group.id,
      });
      await vi.advanceTimersByTimeAsync(1);
      expect((await dm).data).toMatchObject({ kind: "dm" });
      actor = undefined;
      const denied = expect(
        client.call("community.group.list", {}),
      ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
      await vi.advanceTimersByTimeAsync(1);
      await denied;
    } finally {
      client.stop();
      host.close();
      db.close();
      vi.useRealTimers();
    }
  });
});
