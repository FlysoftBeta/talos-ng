import { createUlid } from "@talos/base";
import type { User } from "@talos/contract";
import { afterEach, describe, expect, it } from "vitest";
import { Db } from "../../kernel/persistence/db.ts";
import { Uow } from "../../kernel/persistence/uow.ts";
import { SyncHub } from "../../kernel/sync/sync-hub.ts";
import { CommunityService } from "./index.ts";
const databases: Db[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function setup() {
  const db = new Db();
  databases.push(db);
  let now = 1000;
  const id = createUlid({ clock: () => now, random: () => 0.5 });
  const users: User[] = Array.from({ length: 4 }, (_, n) => ({
    id: id(),
    name: `用户${n}`,
    handle: `u${n}`,
    roles: n === 0 ? ["root", "administrator"] : [],
    features: [],
  }));
  const errors: unknown[] = [];
  const hubRef: { current?: SyncHub } = {};
  const uow = new Uow(
    db,
    { committed: (set) => hubRef.current?.committed(set) },
    (error) => errors.push(error),
  );
  const changes: string[] = [];
  const service = new CommunityService({
    db,
    uow,
    now: () => now,
    id,
    user: (id) => users.find((user) => user.id === id),
    users: () => users,
    onMembershipChanged: (user, conv, joined) =>
      changes.push(`${user}:${conv}:${joined}`),
  });
  const hub = new SyncHub({
    revision: () => uow.revision,
    reportError: (error) => errors.push(error),
  });
  hubRef.current = hub;
  service.registerSync(hub);
  return {
    db,
    service,
    uow,
    hub,
    users,
    errors,
    changes,
    a: users[1]!.id,
    b: users[2]!.id,
    c: users[3]!.id,
    root: users[0]!.id,
    advance: () => now++,
  };
}
describe("community", () => {
  it("seeds exactly two immutable system groups and all current users", () => {
    const s = setup();
    expect(s.service.conversations(s.a).map((row) => row.type)).toEqual([
      "wild",
      "announcement",
    ]);
    for (const conv of s.service.conversations(s.a)) {
      expect(s.service.members(conv.id)).toHaveLength(4);
      expect(() => s.service.leave(s.a, conv.id)).toThrow(/不能退出/);
    }
    new CommunityService({ ...s.service.options });
    expect(s.service.repo.all()).toHaveLength(2);
    expect(s.service.canPost(s.a, s.service.conversations(s.a)[1]!.id)).toBe(
      false,
    );
    expect(s.service.canPost(s.root, s.service.conversations(s.a)[1]!.id)).toBe(
      true,
    );
  });
  it("initializes new users idempotently and gives valid system membership revisions", () => {
    const s = setup();
    const user = { ...s.users[0]!, id: createUlid()(), name: "新增" };
    s.users.push(user);
    s.service.initializeUser(user.id);
    const rev = s.uow.revision;
    s.service.initializeUser(user.id);
    expect(s.uow.revision).toBe(rev);
    expect(s.service.repo.memberships(user.id)).toHaveLength(2);
  });
  it("creates a joined parented group with normalized name and unique case-insensitive handles", () => {
    const s = setup();
    const parent = s.service.conversations(s.a)[0]!;
    const group = s.service.create(s.a, {
      name: "  班级  ",
      handle: "Class",
      parent: parent.id,
      discoverable: true,
    });
    expect(group).toMatchObject({
      name: "班级",
      owner: s.a,
      parent: parent.id,
      handle: "Class",
    });
    expect(s.service.canAccess(s.a, group.id)).toBe(true);
    expect(() =>
      s.service.create(s.b, { name: "重复", handle: "class" }),
    ).toThrow(/标识已存在/);
    expect(() =>
      s.service.create(s.b, { name: "子群", parent: group.id }),
    ).toThrow(/不在/);
    expect(() =>
      s.service.create(s.a, { name: " ", handle: "bad handle" }),
    ).toThrow(/无效/);
  });
  it("validates search provenance and inaccessible parents on the server", () => {
    const s = setup();
    const parent = s.service.create(s.a, { name: "父群", discoverable: true });
    const child = s.service.create(s.a, {
      name: "搜索群",
      parent: parent.id,
      discoverable: true,
    });
    expect(s.service.find(s.b, "搜索")).toEqual([]);
    expect(() => s.service.join(s.b, child.id, { type: "search" })).toThrow(
      /来源无效/,
    );
    s.service.join(s.b, parent.id, { type: "search" });
    expect(s.service.find(s.b, "搜索")).toHaveLength(1);
    s.service.join(s.b, child.id, { type: "search" });
    expect(s.service.canAccess(s.b, child.id)).toBe(true);
  });
  it("allows a nondiscoverable linked child only through the correct accessible parent", () => {
    const s = setup();
    const parent = s.service.conversations(s.a)[0]!;
    const child = s.service.create(s.a, {
      name: "隐藏搜索",
      parent: parent.id,
    });
    expect(s.service.find(s.b, "隐藏搜索")).toEqual([]);
    expect(s.service.children(s.b, parent.id)).toContainEqual(child);
    expect(() => s.service.join(s.b, child.id, { type: "search" })).toThrow(
      /来源/,
    );
    expect(() =>
      s.service.join(s.b, child.id, {
        type: "group",
        group: s.service.conversations(s.a)[1]!.id,
      }),
    ).toThrow(/来源/);
    s.service.join(s.b, child.id, { type: "group", group: parent.id });
    expect(s.service.canAccess(s.b, child.id)).toBe(true);
  });
  it("salts passwords and never returns credentials in metadata or sync", () => {
    const s = setup();
    const group = s.service.create(s.a, {
      name: "口令群",
      password: "private-value",
      discoverable: true,
    });
    expect(group.passwordRequired).toBe(true);
    expect(s.service.repo.get(group.id)!.password_hash).not.toContain(
      "private-value",
    );
    for (const password of [undefined, "wrong"])
      expect(() =>
        s.service.join(s.b, group.id, { type: "search" }, password),
      ).toThrow(/密码/);
    s.service.join(s.b, group.id, { type: "search" }, "private-value");
    expect(JSON.stringify(s.hub.pull(s.b, { cursors: {} }))).not.toContain(
      "private-value",
    );
  });
  it("redacts hidden members in shared scopes while preserving own private membership", () => {
    const s = setup();
    const group = s.service.create(s.a, { name: "可见性", discoverable: true });
    s.service.join(s.b, group.id, { type: "search" });
    s.service.hide(s.b, group.id, true);
    expect(
      s.service.visibleMembers(s.a, group.id).members.map((row) => row.user),
    ).toEqual([s.a]);
    expect(s.service.visibleMembers(s.b, group.id).self.hidden).toBe(true);
    const pull = s.hub.pull(s.a, { cursors: {} });
    const member = pull.scopes[`conv:${group.id}`]!.rows.find(
      (row) => row.type === "communityMember" && row.id === s.b,
    );
    expect(member).toMatchObject({ deleted: true, data: null });
    expect(
      s.hub
        .pull(s.b, { cursors: {} })
        .scopes[`me:${s.b}`]!.rows.find((row) => row.id === group.id),
    ).toMatchObject({ data: { hidden: true } });
    s.service.hide(s.b, group.id, false);
    expect(s.service.visibleMembers(s.a, group.id).members).toHaveLength(2);
  });
  it("hidden-member group globally redacts identities and denies private-message proof", () => {
    const s = setup();
    const group = s.service.create(s.a, {
      name: "隐藏成员",
      membersHidden: true,
      discoverable: true,
    });
    s.service.join(s.b, group.id, { type: "search" });
    expect(s.service.visibleMembers(s.a, group.id).members).toHaveLength(1);
    expect(() => s.service.openDm(s.a, s.b, group.id)).toThrow(/共同群组/);
  });
  it("enforces admin-only posting without giving administrators access to private groups", () => {
    const s = setup();
    const group = s.service.create(s.a, {
      name: "只读",
      adminOnly: true,
      discoverable: true,
    });
    s.service.join(s.b, group.id, { type: "search" });
    expect(s.service.canPost(s.a, group.id)).toBe(true);
    expect(s.service.canPost(s.b, group.id)).toBe(false);
    expect(s.service.canPost(s.root, group.id)).toBe(false);
  });
  it("protects no-leave groups and retains membership tombstones for ordinary leaves", () => {
    const s = setup();
    const locked = s.service.create(s.a, { name: "固定", noLeave: true });
    expect(() => s.service.leave(s.a, locked.id)).toThrow(/不能退出/);
    const group = s.service.create(s.a, { name: "退出", discoverable: true });
    s.service.join(s.b, group.id, { type: "search" });
    s.service.leave(s.b, group.id);
    expect(s.service.repo.member(s.b, group.id)!.deleted).toBe(1);
    expect(s.service.canAccess(s.b, group.id)).toBe(false);
    s.service.join(s.b, group.id, { type: "search" });
    expect(s.service.repo.member(s.b, group.id)!.deleted).toBe(0);
  });
  it("deduplicates symmetric DMs and rejects forged, hidden and self proofs", () => {
    const s = setup();
    const group = s.service.create(s.a, {
      name: "私聊来源",
      discoverable: true,
    });
    s.service.join(s.b, group.id, { type: "search" });
    const dm = s.service.openDm(s.a, s.b, group.id);
    expect(s.service.openDm(s.b, s.a, group.id).id).toBe(dm.id);
    expect(s.service.members(dm.id)).toHaveLength(2);
    expect(s.service.canAccess(s.c, dm.id)).toBe(false);
    expect(() => s.service.openDm(s.a, s.a, group.id)).toThrow(/自己/);
    expect(() => s.service.openDm(s.a, s.c, group.id)).toThrow(/共同/);
    s.service.hide(s.b, group.id, true);
    expect(() => s.service.openDm(s.a, s.b, group.id)).toThrow(/共同/);
  });
  it("repairs imported DMs that have no memberships or name", () => {
    const s = setup();
    const group = s.service.create(s.a, {
      name: "私聊来源",
      discoverable: true,
    });
    s.service.join(s.b, group.id, { type: "search" });
    // The legacy import stored the pair without members or a name.
    s.db.run(
      "INSERT INTO community_conversations VALUES('legacy','dm','normal','','legacy',NULL,NULL,0,0,0,0,NULL,?,1,1,0)",
      [s.a, s.b].sort().join(":"),
    );
    expect(s.service.openDm(s.a, s.b, group.id).id).toBe("legacy");
    expect(s.service.canAccess(s.a, "legacy")).toBe(false);
    s.service.repairDms();
    expect(s.service.canAccess(s.a, "legacy")).toBe(true);
    expect(s.service.canAccess(s.b, "legacy")).toBe(true);
    expect(s.service.conversation("legacy")!.name).toBe("用户1 · 用户2");
    expect(Object.keys(s.hub.pull(s.a, { cursors: {} }).scopes)).toContain(
      "conv:legacy",
    );
    const revision = s.uow.revision;
    s.service.repairDms();
    expect(s.uow.revision).toBe(revision);
  });
  it("pushes scope added and gone immediately on membership changes", () => {
    const s = setup();
    const emitted: unknown[] = [];
    s.hub.pull(
      s.b,
      { cursors: {} },
      { id: "b", emit: (_topic, data) => emitted.push(data) },
    );
    const group = s.service.create(s.a, { name: "同步", discoverable: true });
    s.service.join(s.b, group.id, { type: "search" });
    expect(emitted).toContainEqual(
      expect.objectContaining({ added: [`conv:${group.id}`] }),
    );
    s.hub.pull(s.b, { cursors: {} });
    s.service.leave(s.b, group.id);
    expect(emitted).toContainEqual(
      expect.objectContaining({ gone: [`conv:${group.id}`] }),
    );
    expect(s.errors).toEqual([]);
  });
  it("preserves membership and authorization invariants across repeated randomized toggles", () => {
    const s = setup();
    const group = s.service.create(s.a, { name: "不变量", discoverable: true });
    let seed = 27;
    for (let n = 0; n < 80; n++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const user = seed % 2 ? s.b : s.c;
      if (s.service.canAccess(user, group.id)) s.service.leave(user, group.id);
      else s.service.join(user, group.id, { type: "search" });
      const active = s.service.members(group.id).map((row) => row.user);
      for (const member of [s.a, s.b, s.c])
        expect(s.service.canAccess(member, group.id)).toBe(
          active.includes(member),
        );
      expect(new Set(active).size).toBe(active.length);
    }
  });
});
