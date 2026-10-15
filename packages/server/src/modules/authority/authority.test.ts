import { OPS_ACTION_ROLES, contract, opsActionRole } from "@talos/contract";
import { describe, expect, it } from "vitest";
import { AppError } from "@talos/base";
import type { AuthorityAction } from "@talos/contract";
import { Db } from "../../kernel/persistence/db.ts";
import { Uow } from "../../kernel/persistence/uow.ts";
import { SyncHub } from "../../kernel/sync/sync-hub.ts";
import { IdentityService, ProvisioningRepo } from "../identity/index.ts";
import { AuthorityService } from "./index.ts";
function setup() {
  const db = new Db();
  const uow = new Uow(db, { committed: () => {} });
  const identity = new IdentityService({
    db,
    uow,
    projectAccess: (user) => authority.repo.project(user),
  });
  const authority: AuthorityService = new AuthorityService({
    identity: identity.repo,
    db,
    uow,
    groups: (user) => (user.endsWith("GROUP") ? ["group"] : []),
  });
  const root = identity.createUser({
    pin: "111111",
    name: "管理",
    roles: ["root"],
  });
  const user = identity.createUser({ pin: "222222", name: "普通" });
  return { db, uow, authority, identity, root, user };
}
describe("authority policy", () => {
  it("covers every ops method and applies root/admin policy from current authority access", () => {
    const s = setup();
    try {
      for (const methods of Object.values(contract.ops))
        for (const method of Object.values(methods))
          expect(opsActionRole(method.name)).toBeDefined();
      for (const action of Object.keys(
        OPS_ACTION_ROLES,
      ) as (keyof typeof OPS_ACTION_ROLES)[]) {
        expect(s.authority.can(s.root.id, action)).toBe(true);
        expect(s.authority.can(s.user.id, action)).toBe(false);
      }
      s.authority.setAccess(s.user.id, { roles: ["administrator"] });
      for (const action of Object.keys(
        OPS_ACTION_ROLES,
      ) as (keyof typeof OPS_ACTION_ROLES)[])
        expect(s.authority.can(s.user.id, action)).toBe(
          OPS_ACTION_ROLES[action] === "administrator",
        );
      s.authority.setAccess(s.user.id, { roles: ["root"] });
      expect(s.authority.can(s.user.id, "ops.host.run")).toBe(true);
      s.authority.setAccess(s.user.id, { roles: [] });
      expect(s.authority.can(s.user.id, "ops.backup.create")).toBe(false);
      s.db.run("UPDATE users SET banned=1 WHERE id=?", s.root.id);
      expect(s.authority.can(s.root.id, "ops.host.run")).toBe(false);
      expect(s.authority.can("missing", "ops.backup.list")).toBe(false);
    } finally {
      s.db.close();
    }
  });
  it("requires specialist roles, projects access and protects the last root", () => {
    const s = setup();
    try {
      expect(s.authority.can(s.user.id, "identity.invitation.create")).toBe(
        false,
      );
      expect(s.authority.can(s.root.id, "identity.invitation.create")).toBe(
        true,
      );
      expect(() => s.authority.setAccess(s.root.id, { roles: [] })).toThrow(
        AppError,
      );
      s.authority.setAccess(s.user.id, {
        roles: ["access_manager"],
        features: ["article_reader"],
      });
      expect(
        s.identity.repo.publicUser(s.identity.repo.user(s.user.id)!),
      ).toMatchObject({
        roles: ["administrator", "access_manager"],
        features: ["article_reader"],
      });
      expect(s.authority.can(s.user.id, "identity.invitation.create")).toBe(
        true,
      );
      expect(
        s.authority.can(s.user.id, "feature.use", {
          feature: "article_reader",
        }),
      ).toBe(false);
      expect(s.authority.can(s.user.id, "authority.roles.set")).toBe(false);
    } finally {
      s.db.close();
    }
  });
  it("enforces read/write/own monotonic rights and tombstones revocations without root bypass", () => {
    const s = setup();
    try {
      const levels = ["read", "write", "own"] as const;
      const actions = [
        "resource.read",
        "resource.write",
        "resource.own",
      ] as const;
      for (let level = 0; level < 3; level++) {
        s.authority.setGrant({
          resource: "book:1",
          principalType: "user",
          principal: s.user.id,
          level: levels[level]!,
        });
        for (let action = 0; action < 3; action++)
          expect(
            s.authority.can(s.user.id, actions[action]!, { id: "book:1" }),
          ).toBe(action <= level);
      }
      expect(
        s.authority.can(s.root.id, "resource.read", { id: "book:1" }),
      ).toBe(false);
      expect(
        s.authority.can(s.user.id, "unknown" as AuthorityAction, {
          id: "book:1",
          owner: s.user.id,
        }),
      ).toBe(false);
      s.authority.setGrant({
        resource: "book:1",
        principalType: "user",
        principal: s.user.id,
        level: null,
      });
      expect(
        s.authority.can(s.user.id, "resource.read", { id: "book:1" }),
      ).toBe(false);
      expect(s.authority.repo.allGrants()).toHaveLength(1);
      expect(s.authority.repo.allGrants()[0]!.deleted).toBe(1);
    } finally {
      s.db.close();
    }
  });
  it("syncs grants and revocation tombstones only to the intended principal", () => {
    const s = setup();
    try {
      const hub = new SyncHub({ revision: () => s.uow.revision });
      s.authority.registerSync(hub);
      s.authority.setGrant({
        resource: "book:1",
        principalType: "user",
        principal: s.user.id,
        level: "write",
      });
      const scope = `me:${s.user.id}`;
      const first = hub.pull(s.user.id, { cursors: {} });
      expect(first.scopes[scope]!.rows[0]!.data).toMatchObject({
        resource: "book:1",
        level: "write",
      });
      expect(
        hub.pull(s.root.id, { cursors: {} }).scopes[`me:${s.root.id}`]!.rows,
      ).toEqual([]);
      const rev = s.uow.revision;
      s.authority.setGrant({
        resource: "book:1",
        principalType: "user",
        principal: s.user.id,
        level: null,
      });
      expect(
        hub.pull(s.user.id, { cursors: { [scope]: rev } }).scopes[scope]!
          .rows[0]!.deleted,
      ).toBe(true);
    } finally {
      s.db.close();
    }
  });
  it("resolves group principals through an injected membership provider", () => {
    const s = setup();
    try {
      const authority = new AuthorityService({
        identity: s.identity.repo,
        db: s.db,
        uow: s.uow,
        groups: (user) => (user === s.user.id ? ["class-A"] : []),
      });
      authority.setGrant({
        resource: "book:2",
        principalType: "group",
        principal: "class-A",
        level: "write",
      });
      expect(authority.can(s.user.id, "resource.write", { id: "book:2" })).toBe(
        true,
      );
      expect(authority.can(s.root.id, "resource.read", { id: "book:2" })).toBe(
        false,
      );
    } finally {
      s.db.close();
    }
  });
  it("imports a migrated grant idempotently and projects it only to matching principals across batches", () => {
    const s = setup();
    try {
      const members = new Set<string>();
      const authority = new AuthorityService({
        identity: s.identity.repo,
        db: s.db,
        uow: s.uow,
        groups: (user) => (members.has(user) ? ["class-A"] : []),
      });
      // More users than one projection batch (500) so the cursor loop must continue.
      const filler: string[] = [];
      s.uow.write((ctx) => {
        for (let i = 0; i < 1100; i++) {
          const id = `01HZZZZZZZZZZZZZZZZZZZ${String(i).padStart(4, "0")}`;
          new ProvisioningRepo(s.db).createUser(
            {
              id,
              handle: `bulk${i}`,
              name: `批量${i}`,
              roles: [],
              features: [],
              credentialVersion: 1,
            },
            id,
            0,
            ctx.rev,
          );
          filler.push(id);
          if (i % 3 === 0) members.add(id);
        }
      });
      authority.importGrant({
        id: "G-USER",
        resource: "book:imp",
        principalType: "user",
        principal: filler[1000]!,
        level: "read",
      });
      authority.importGrant({
        id: "G-GROUP",
        resource: "book:imp2",
        principalType: "group",
        principal: "class-A",
        level: "write",
      });
      // Reimporting the same id does not duplicate the grant.
      authority.importGrant({
        id: "G-GROUP",
        resource: "book:imp2",
        principalType: "group",
        principal: "class-A",
        level: "write",
      });
      expect(
        authority.can(filler[1000]!, "resource.read", { id: "book:imp" }),
      ).toBe(true);
      expect(
        authority.can(filler[1]!, "resource.read", { id: "book:imp" }),
      ).toBe(false);
      const holders = filler.filter((id) =>
        authority.can(id, "resource.write", { id: "book:imp2" }),
      );
      expect(holders).toEqual(filler.filter((id) => members.has(id)));
      expect(authority.repo.grants("book:imp2")).toHaveLength(1);
      // Projection rows exist for exactly the matching users (group members + the direct user).
      expect(
        s.db.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM authority_grant_projections WHERE grant_id IN ('G-USER','G-GROUP')",
        )?.n,
      ).toBe(holders.length + 1);
    } finally {
      s.db.close();
    }
  });
});
