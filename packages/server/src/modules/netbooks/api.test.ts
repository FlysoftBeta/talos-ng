// Backend API availability for the network-books feature (task 150 (c)): real kernel behind
// the real link host; both `netbooks.*` methods answer, anonymous and ungated callers are
// refused.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUlid, deferred } from "@talos/base";
import { createApi, netbooks } from "@talos/contract";
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
function assemble(): Kernel {
  const kernel = createKernel({
    db: new Db(),
    store: createMemoryObjectStore(),
    build: "test",
    dev: true,
    testSeed: true,
    netbooksWait: async () => {},
  });
  kernels.push(kernel);
  return kernel;
}

describe("netbooks API availability", () => {
  it("answers search and download for an entitled user", async () => {
    const kernel = assemble();
    const { api } = await open(kernel);
    await api.auth.device.register({});
    const login = await api.auth.login({ pin: "123456" });
    if (!("user" in login)) throw new Error("expected a session");
    const found = await api.netbooks.search({ query: "测试作者" });
    expect(found.books[0]).toMatchObject({ id: "10001", title: "星河漫游" });
    const { id: collection } = await api.library.collection.create({
      title: "网络小说",
    });
    const started = await api.netbooks.download({ book: "10001", collection });
    await vi.waitFor(
      () => expect(kernel.jobs.get(started.job)?.state).toBe("done"),
      { timeout: 20_000 },
    );
  });

  it("refuses both methods to anonymous callers and to accounts without article_download", async () => {
    const kernel = assemble();
    const anonymous = await open(kernel);
    const ordinary = await open(kernel);
    await ordinary.api.auth.device.register({});
    const login = await ordinary.api.auth.login({ pin: "654321" });
    if (!("user" in login)) throw new Error("expected a session");
    kernel.authority.setAccess(login.user.id, { features: [] });
    const id = createUlid()();
    const calls = {
      [netbooks.search.name]: { query: "星河" },
      [netbooks.download.name]: { book: "10001", collection: id },
    };
    for (const [name, args] of Object.entries(calls)) {
      await expect(
        anonymous.client.call(name, args),
        name,
      ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
      await expect(
        ordinary.client.call(name, args),
        name,
      ).rejects.toMatchObject({
        code: "E_DENIED",
      });
    }
  });
});
