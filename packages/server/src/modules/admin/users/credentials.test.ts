import { expect, it } from "vitest";
import { deferred } from "@talos/base";
import { createApi } from "@talos/contract";
import { LinkClient, createMemoryCarrierPair } from "@talos/link";
import { createMemoryObjectStore } from "@talos/objectstore";
import { createKernel } from "../../../app/create-application.ts";
import { Db } from "../../../kernel/persistence/db.ts";

it("admin PIN reset checks role and collisions, revokes the old session and admits only the replacement PIN", async () => {
  const db = new Db();
  const kernel = createKernel({
    db,
    store: createMemoryObjectStore(),
    build: "test",
    dev: true,
    testSeed: true,
  });
  const clients: LinkClient[] = [];
  const target = kernel.identity.createUser({
    handle: "reset_target",
    name: "目标",
    pin: "112233",
  });
  kernel.identity.createUser({
    handle: "moderator",
    name: "社区管理员",
    pin: "333444",
    roles: ["community_manager"],
  });
  async function login(pin: string) {
    const ready = deferred<void>();
    const client = new LinkClient({
      connect: async () => {
        const pair = createMemoryCarrierPair();
        kernel.host.link.accept(pair.b, {});
        return pair.a;
      },
      hello: () => ({ v: 1, build: "test", device: null, lang: "zh-CN" }),
    });
    clients.push(client);
    client.onWelcome(() => ready.resolve());
    client.start();
    await ready.promise;
    const api = createApi(client.call.bind(client));
    await api.auth.device.register({});
    await api.auth.login({ pin });
    return api;
  }
  try {
    const ordinary = await login("112233");
    const moderator = await login("333444");
    await expect(
      ordinary.admin.user.update({ id: target.id, pin: "223344" }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await expect(
      moderator.admin.user.update({ id: target.id, name: "越权资料" }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await expect(
      moderator.admin.user.update({ id: target.id, pin: "123456" }),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });
    await ordinary.sync.pull({ cursors: {} });
    await moderator.admin.user.update({ id: target.id, pin: "223344" });
    await expect(ordinary.sync.pull({ cursors: {} })).rejects.toMatchObject({
      code: "E_UNAUTHENTICATED",
    });
    await expect(ordinary.auth.login({ pin: "112233" })).rejects.toMatchObject({
      code: "E_UNAUTHENTICATED",
    });
    expect(await ordinary.auth.login({ pin: "223344" })).toMatchObject({
      user: { id: target.id },
    });
  } finally {
    clients.forEach((c) => c.stop());
    await kernel.close();
    db.close();
  }
});
