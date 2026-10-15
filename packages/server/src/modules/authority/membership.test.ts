import { describe, expect, it } from "vitest";
import { Db } from "../../kernel/persistence/db.ts";
import { Uow } from "../../kernel/persistence/uow.ts";
import { SyncHub } from "../../kernel/sync/sync-hub.ts";
import { IdentityService } from "../identity/index.ts";
import { CommunityService } from "../community/index.ts";
import { AuthorityService } from "./index.ts";

describe("authority community grant projection", () => {
  it("reprojects old grants on join and tombstones only the departed member on leave", () => {
    const db = new Db();
    const pending: { hub?: SyncHub } = {};
    const errors: unknown[] = [];
    const uow = new Uow(db, {
      committed: (set) => pending.hub?.committed(set),
    });
    const communityRef: { current?: CommunityService } = {};
    const identity = new IdentityService({
      db,
      uow,
      projectAccess: (user) => authority.repo.project(user),
    });
    const authority: AuthorityService = new AuthorityService({
      identity: identity.repo,
      db,
      uow,
      groups: (user) => communityRef.current?.groups(user) ?? [],
    });
    const a = identity.createUser({ pin: "123456", name: "甲" });
    const b = identity.createUser({ pin: "234567", name: "乙" });
    const service = new CommunityService({
      db,
      uow,
      user: (id) => authority.repo.actor(id),
      users: () =>
        authority.repo.users().map((id) => authority.repo.actor(id)!),
      onMembershipChanged: (user, group, _joined, ctx) =>
        authority.membershipChanged(user, group, ctx),
    });
    communityRef.current = service;
    const hub = new SyncHub({
      revision: () => uow.revision,
      reportError: (error) => errors.push(error),
    });
    pending.hub = hub;
    service.registerSync(hub);
    authority.registerSync(hub);
    try {
      const group = service.create(a.id, {
        name: "授权群",
        discoverable: true,
      });
      authority.setGrant({
        resource: "book:1",
        principalType: "group",
        principal: group.id,
        level: "read",
      });
      const scope = `me:${b.id}`;
      const messages: unknown[] = [];
      const initial = hub.pull(
        b.id,
        { cursors: {} },
        { id: "b", emit: (_topic, data) => messages.push(data) },
      );
      const cursor = initial.scopes[scope]!.cursor;
      service.join(b.id, group.id, { type: "search" });
      const joined = hub
        .pull(b.id, { cursors: { [scope]: cursor } })
        .scopes[scope]!.rows.find((row) => row.type === "grant")!;
      expect(joined.deleted).toBe(false);
      expect(joined.rev).toBeGreaterThan(cursor);
      expect(authority.can(b.id, "resource.read", { id: "book:1" })).toBe(true);
      service.leave(b.id, group.id);
      const left = hub
        .pull(b.id, { cursors: { [scope]: joined.rev } })
        .scopes[scope]!.rows.find((row) => row.type === "grant")!;
      expect(left).toMatchObject({ id: joined.id, deleted: true, data: null });
      expect(authority.can(b.id, "resource.read", { id: "book:1" })).toBe(
        false,
      );
      expect(
        hub
          .pull(a.id, { cursors: {} })
          .scopes[`me:${a.id}`]!.rows.find((row) => row.id === joined.id)!
          .deleted,
      ).toBe(false);
      service.join(b.id, group.id, { type: "search" });
      expect(
        hub
          .pull(b.id, { cursors: { [scope]: left.rev } })
          .scopes[scope]!.rows.find((row) => row.id === joined.id)!.deleted,
      ).toBe(false);
      expect(errors).toEqual([]);
      expect(messages.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});
