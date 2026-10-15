import { expect, it } from "vitest";
import { createMemoryObjectStore } from "@talos/objectstore";
import { Db } from "../../../kernel/persistence/db.ts";
import { createKernel } from "../../../app/create-application.ts";

function fixture() {
  const db = new Db();
  const kernel = createKernel({
    db,
    store: createMemoryObjectStore(),
    build: "test",
    dev: true,
    testSeed: true,
    backgroundTasks: false,
    clock: {
      now: () => 1_000_000,
      setTimeout: () => 0,
      clearTimeout: () => {},
    },
  });
  const root = kernel.admin.listUsers({ query: "root" }).items[0]!.id;
  return {
    db,
    kernel,
    root,
    close: async () => {
      await kernel.close();
      db.close();
    },
  };
}

it("filters and counts before stable paging, then overlays access and batched mutes", async () => {
  const f = fixture();
  try {
    const users = ["c", "a", "b"].map(
      (suffix, index) =>
        f.kernel.admin.createUser(f.root, {
          handle: `paging_${suffix}`,
          name: "Paging Name",
          pin: `47100${index}`,
        }).user,
    );
    f.kernel.authority.setAccess(users[0]!.id, {
      roles: ["community_manager"],
      features: ["media"],
    });
    f.kernel.chat.mute(users[0]!.id, 2_000_000);
    for (const sort of ["handle", "name", "created"] as const) {
      const expected = [...users].sort((a, b) =>
        sort === "handle"
          ? a.handle.localeCompare(b.handle)
          : a.id.localeCompare(b.id),
      );
      const actual = [];
      for (let offset = 0; offset < 4; offset++) {
        const page = f.kernel.admin.listUsers({
          query: "paging_",
          sort,
          offset,
          limit: 1,
        });
        expect(page.total).toBe(3);
        expect(page.items).toHaveLength(offset < 3 ? 1 : 0);
        actual.push(...page.items);
      }
      expect(actual.map((user) => user.id)).toEqual(
        expected.map((user) => user.id),
      );
      const overlaid = actual.find((user) => user.id === users[0]!.id)!;
      expect(overlaid.roles).toContain("community_manager");
      expect(overlaid.features).toEqual(["media"]);
      expect(overlaid.mutedUntil).toBe(2_000_000);
      expect(
        actual
          .filter((user) => user.id !== overlaid.id)
          .map((user) => user.mutedUntil),
      ).toEqual([0, 0]);
    }
    expect(f.kernel.admin.listUsers({ query: "%", limit: 1 }).total).toBe(0);
  } finally {
    await f.close();
  }
});

it("rolls profile, access, mute, status, sessions and revision back when the final audit fails", async () => {
  const f = fixture();
  try {
    const user = f.kernel.admin.createUser(f.root, {
      handle: "rollback_user",
      pin: "471009",
    }).user;
    const device = f.kernel.identity.registerDevice();
    const session = f.kernel.identity.login(device, "471009");
    expect(session).toHaveProperty("token");
    const beforeSessions = f.db.all("SELECT * FROM sessions");
    const revision = f.kernel.uow.revision;
    const audit = f.kernel.audit.list();
    f.db.exec(
      "CREATE TRIGGER reject_admin_audit BEFORE INSERT ON audit WHEN NEW.action='admin.user.update' BEGIN SELECT RAISE(ABORT,'injected audit failure'); END",
    );
    await expect(
      f.kernel.admin.updateUser(f.root, {
        id: user.id,
        handle: "changed",
        name: "Changed",
        roles: ["community_manager"],
        features: ["media"],
        mutedUntil: 2_000_000,
        banned: true,
      }),
    ).rejects.toThrow("injected audit failure");
    expect(f.kernel.admin.listUsers({ query: user.handle }).items).toEqual([
      user,
    ]);
    expect(f.db.all("SELECT * FROM sessions")).toEqual(beforeSessions);
    expect(f.kernel.uow.revision).toBe(revision);
    expect(f.kernel.audit.list()).toEqual(audit);
    f.db.exec("DROP TRIGGER reject_admin_audit");
    await f.kernel.admin.updateUser(f.root, {
      id: user.id,
      features: ["media"],
      banned: true,
    });
    expect(
      f.kernel.admin.listUsers({ query: user.handle }).items[0],
    ).toMatchObject({ banned: true, features: ["media"] });
    expect(f.db.all("SELECT * FROM sessions")).toEqual([]);
  } finally {
    await f.close();
  }
});

it("rolls device changes and session revocation back together on failure", async () => {
  const f = fixture();
  try {
    const user = f.kernel.admin.createUser(f.root, {
      handle: "device_owner",
      pin: "471008",
    }).user;
    const device = f.kernel.identity.registerDevice();
    f.kernel.identity.login(device, "471008");
    const before = f.kernel.admin.listDevices({}).items;
    const sessions = f.db.all("SELECT * FROM sessions");
    expect(sessions).toHaveLength(1);
    f.db.exec(
      "CREATE TRIGGER reject_device_audit BEFORE INSERT ON audit WHEN NEW.action IN ('admin.device.update','admin.device.delete') BEGIN SELECT RAISE(ABORT,'injected audit failure'); END",
    );
    expect(() =>
      f.kernel.admin.updateDevice(
        f.root,
        { id: device, locked: true, boundUser: user.id },
        "another-device",
      ),
    ).toThrow("injected audit failure");
    expect(f.kernel.admin.listDevices({}).items).toEqual(before);
    expect(f.db.all("SELECT * FROM sessions")).toEqual(sessions);
    expect(() =>
      f.kernel.admin.deleteDevice(f.root, device, "another-device"),
    ).toThrow("injected audit failure");
    expect(f.kernel.admin.listDevices({}).items).toEqual(before);
    expect(f.db.all("SELECT * FROM sessions")).toEqual(sessions);
    f.db.exec("DROP TRIGGER reject_device_audit");
    f.kernel.admin.deleteDevice(f.root, device, "another-device");
    expect(f.kernel.admin.listDevices({}).items).toEqual([]);
    expect(f.db.all("SELECT * FROM sessions")).toEqual([]);
  } finally {
    await f.close();
  }
});
