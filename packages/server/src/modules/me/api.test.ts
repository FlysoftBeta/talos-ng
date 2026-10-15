// Backend API availability for the personal-settings feature (task 150 (c)): real kernel
// behind the real link host; `me.setting.set` answers and its identity/operation guards hold.
import { afterEach, describe, expect, it } from "vitest";
import { createUlid, deferred } from "@talos/base";
import { createApi } from "@talos/contract";
import { createMemoryCarrierPair, LinkClient } from "@talos/link";
import { createMemoryObjectStore } from "@talos/objectstore";
import { createKernel } from "../../app/create-application.ts";
import type { Kernel } from "../../app/create-application.ts";
import { Db } from "../../kernel/persistence/db.ts";

const kernels: Kernel[] = [];
const clients: LinkClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.stop());
  for (const k of kernels.splice(0)) {
    await k.close();
    k.db.close();
  }
});
async function open(kernel: Kernel) {
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
  return { client, api: createApi(client.call.bind(client)) };
}

describe("me API availability", () => {
  it("stores a setting for the signed-in user, rejects anonymous calls and mismatched operation ids", async () => {
    const kernel = createKernel({
      db: new Db(),
      store: createMemoryObjectStore(),
      build: "test",
      dev: true,
      testSeed: true,
    });
    kernels.push(kernel);
    const anonymous = await open(kernel);
    const { api } = await open(kernel);
    await api.auth.device.register({});
    const login = await api.auth.login({ pin: "654321" });
    if (!("user" in login)) throw new Error("expected a session");
    const op = createUlid()();
    const args = {
      key: "theme",
      value: { v: "dark", t: { ms: Date.now(), counter: 0 }, op },
    };
    await expect(
      anonymous.api.me.setting.set(args, { op }),
    ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
    await api.me.setting.set(args, { op });
    const pulled = await api.sync.pull({ cursors: {} });
    const rows = pulled.scopes[`me:${login.user.id}`]!.rows;
    expect(
      rows.find((r) => r.type === "setting" && r.id === "theme")?.data,
    ).toMatchObject({ key: "theme", value: { v: "dark" } });
    await expect(
      api.me.setting.set(args, { op: createUlid()() }),
    ).rejects.toMatchObject({ code: "E_INVALID" });
  });
});
