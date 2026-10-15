import { describe, it, expect } from "vitest";
import { createMemoryObjectStore } from "@talos/objectstore";
import { createApi } from "@talos/contract";
import { LinkClient, createMemoryCarrierPair } from "@talos/link";
import { deferred } from "@talos/base";
import { Db } from "../../../kernel/persistence/db.ts";
import { createKernel } from "../../../app/create-application.ts";
import type { Kernel } from "../../../app/create-application.ts";
async function connect(kernel: Kernel, device: string | null) {
  const ready = deferred<void>();
  const client = new LinkClient({
    connect: async () => {
      const pair = createMemoryCarrierPair();
      kernel.host.link.accept(pair.b, {});
      return pair.a;
    },
    hello: () => ({ v: 1, build: "test", device, lang: "zh-CN" }),
  });
  client.onWelcome(() => ready.resolve());
  client.start();
  await ready.promise;
  return { client, api: createApi(client.call.bind(client)) };
}
describe("admin group and announcement workbench", () => {
  it("creates, edits, manages members, protects system groups and publishes revisions", async () => {
    const db = new Db();
    const kernel = createKernel({
      db,
      store: createMemoryObjectStore(),
      build: "test",
      dev: true,
      testSeed: true,
    });
    const boot = await connect(kernel, null);
    const device = (await boot.api.auth.device.register({})).device;
    boot.client.stop();
    const admin = await connect(kernel, device);
    try {
      await admin.api.auth.login({ pin: "123456" });
      const user = (
        await admin.api.admin.user.create({ handle: "memberx", pin: "234567" })
      ).user;
      const group = (
        await admin.api.admin.group.create({
          name: "学习组",
          handle: "study_room",
          password: "secret",
          discoverable: true,
          membersHidden: true,
          adminOnly: true,
          noLeave: true,
        })
      ).group;
      expect(group.handle).toBe("study_room");
      expect(group.membersHidden).toBe(true);
      expect(group.passwordRequired).toBe(true);
      const updated = (
        await admin.api.admin.group.update({
          id: group.id,
          name: "进阶学习组",
          password: "",
          noLeave: false,
        })
      ).group;
      expect(updated.name).toBe("进阶学习组");
      expect(updated.passwordRequired).toBe(false);
      await admin.api.admin.group.member({
        id: group.id,
        user: user.id,
        operation: "add",
      });
      expect(
        (await admin.api.admin.group.members({ id: group.id })).some(
          (member) => member.user === user.id,
        ),
      ).toBe(true);
      await admin.api.admin.group.member({
        id: group.id,
        user: user.id,
        operation: "owner",
      });
      expect(
        (await admin.api.admin.group.list({ query: "study_room" })).items[0]
          ?.owner,
      ).toBe(user.id);
      await admin.api.admin.group.member({
        id: group.id,
        user: user.id,
        operation: "kick",
      });
      expect(
        (await admin.api.admin.group.members({ id: group.id })).some(
          (member) => member.user === user.id,
        ),
      ).toBe(false);
      const system = (await admin.api.admin.group.list({})).items.find(
        (item) => item.type !== "normal",
      )!;
      await expect(
        admin.api.admin.group.delete({ id: system.id, name: system.name }),
      ).rejects.toMatchObject({ code: "E_DENIED" });
      await expect(
        admin.api.admin.group.update({ id: system.id, parent: group.id }),
      ).rejects.toMatchObject({ code: "E_DENIED" });
      await expect(
        admin.api.admin.group.member({
          id: system.id,
          user: user.id,
          operation: "kick",
        }),
      ).rejects.toMatchObject({ code: "E_DENIED" });
      await expect(
        admin.api.admin.group.delete({ id: group.id, name: "wrong" }),
      ).rejects.toMatchObject({ code: "E_CONFLICT" });
      await admin.api.admin.group.delete({ id: group.id, name: "进阶学习组" });
      expect(
        (await admin.api.admin.group.list({ query: "study_room" })).total,
      ).toBe(0);
      const tied = [];
      for (const suffix of ["c", "a", "b"]) {
        tied.push(
          (
            await admin.api.admin.group.create({
              name: "Paging group",
              handle: `paging_${suffix}`,
            })
          ).group,
        );
      }
      const ids = tied.map((group) => group.id).sort();
      for (let offset = 0; offset < 4; offset++) {
        const page = await admin.api.admin.group.list({
          query: "paging_",
          offset,
          limit: 1,
        });
        expect(page.total).toBe(3);
        expect(page.items.map((group) => group.id)).toEqual(
          ids.slice(offset, offset + 1),
        );
        for (const group of page.items) {
          expect(group.memberCount).toBe(
            (await admin.api.admin.group.members({ id: group.id })).length,
          );
        }
      }
      expect((await admin.api.admin.group.list({ query: "%" })).total).toBe(0);
      const a = (
        await admin.api.admin.announcement.publish({
          title: "通知",
          text: "请确认",
        })
      ).announcement;
      const b = (
        await admin.api.admin.announcement.publish({
          title: "更新",
          text: "再次确认",
        })
      ).announcement;
      expect(b.revision).toBeGreaterThan(a.revision);
      const history = await admin.api.admin.announcement.list({});
      expect(history.items.map((item) => item.title)).toEqual(["更新", "通知"]);
      expect(history.items[0]?.acknowledged).toBe(0);
      expect(history.items[0]?.audience).toBeGreaterThanOrEqual(2);
      const userBoot = await connect(kernel, null);
      const userDevice = (await userBoot.api.auth.device.register({})).device;
      userBoot.client.stop();
      const other = await connect(kernel, userDevice);
      try {
        const session = await other.api.auth.login({ pin: "234567" });
        if (!("user" in session)) throw new Error("Expected user session");
        await other.api.chat.announcement.ack({ revision: b.revision });
        expect(
          (await admin.api.admin.announcement.list({})).items[0]?.acknowledged,
        ).toBe(1);
        await expect(
          other.api.admin.announcement.publish({ title: "x", text: "y" }),
        ).rejects.toMatchObject({ code: "E_DENIED" });
        const audience = history.items[0]!.audience;
        // Identity eligibility must affect both audience and acknowledgements,
        // including old revisions and pages after the cross-owner join is removed.
        db.run(
          "UPDATE users SET banned=1,banned_until=? WHERE id=?",
          Date.now() + 60_000,
          session.user.id,
        );
        let page = await admin.api.admin.announcement.list({
          offset: 1,
          limit: 1,
        });
        expect(page.total).toBe(2);
        expect(page.items).toMatchObject([
          { revision: a.revision, acknowledged: 0, audience: audience - 1 },
        ]);
        db.run(
          "UPDATE users SET banned_until=? WHERE id=?",
          Date.now() - 1,
          session.user.id,
        );
        page = await admin.api.admin.announcement.list({ offset: 1, limit: 1 });
        expect(page.items).toMatchObject([
          { revision: a.revision, acknowledged: 1, audience },
        ]);
        db.run("UPDATE users SET deleted=1 WHERE id=?", session.user.id);
        page = await admin.api.admin.announcement.list({ offset: 1, limit: 1 });
        expect(page.items).toMatchObject([
          { revision: a.revision, acknowledged: 0, audience: audience - 1 },
        ]);
      } finally {
        other.client.stop();
      }
    } finally {
      admin.client.stop();
      await kernel.close();
      db.close();
    }
  });
});
