// Backend API availability for the task-list feature (task 150 (c)): real kernel behind the
// real link host; retry, cancel and clear answer for the owner, deltas reach only the owner,
// and other users and anonymous callers are refused.
import { afterEach, describe, expect, it } from "vitest";
import { createUlid, deferred } from "@talos/base";
import { createApi } from "@talos/contract";
import { createMemoryCarrierPair, LinkClient } from "@talos/link";
import { createMemoryObjectStore } from "@talos/objectstore";
import { createKernel } from "../../app/create-application.ts";
import { Db } from "../../kernel/persistence/db.ts";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function settle(): Promise<void> {
  for (let i = 0; i < 25; i++) await Promise.resolve();
}

describe("tasks API availability", () => {
  it("cancels, retries and clears the owner's jobs, pushes owner-only deltas and refuses strangers", async () => {
    const kernel = createKernel({
      db: new Db(),
      store: createMemoryObjectStore(),
      build: "test",
      dev: true,
      testSeed: true,
    });
    cleanup.push(async () => {
      await kernel.close();
      kernel.db.close();
    });
    const connect = async (pin: string | null) => {
      const ready = deferred<void>();
      const client = new LinkClient({
        connect: async () => {
          const pair = createMemoryCarrierPair();
          kernel.host.link.accept(pair.b, {});
          return pair.a;
        },
        hello: () => ({ v: 1, build: "test", device: null, lang: "zh-CN" }),
      });
      cleanup.push(() => client.stop());
      client.onWelcome(() => ready.resolve());
      client.start();
      await ready.promise;
      const api = createApi(client.call.bind(client));
      if (!pin) return { client, api, user: "" };
      await api.auth.device.register({});
      const session = await api.auth.login({ pin });
      if ("onboarding" in session) throw new Error("unexpected onboarding");
      return { client, api, user: session.user.id };
    };
    const a = await connect("123456"),
      b = await connect("654321"),
      anonymous = await connect(null);
    await a.api.sync.pull({ cursors: {} });
    const pushed = deferred<unknown>();
    const strangerSaw: unknown[] = [];
    b.client.on("sync.delta", (event) => strangerSaw.push(event.data));
    await b.api.sync.pull({ cursors: {} });
    a.client.on("sync.delta", (event) => {
      if (JSON.stringify(event.data).includes('"job"'))
        pushed.resolve(event.data);
    });
    const job = kernel.jobs.enqueue(a.user, "debug.sleep", { ms: 30000 });
    expect(JSON.stringify(await pushed.promise)).toContain(job.id);
    expect(JSON.stringify(strangerSaw)).not.toContain(job.id);
    for (const call of [
      (api: typeof a.api) => api.tasks.cancel({ id: job.id }),
      (api: typeof a.api) => api.tasks.retry({ id: job.id }),
      (api: typeof a.api) => api.tasks.clear({ id: job.id }),
      (api: typeof a.api) => api.tasks.clear({}),
    ]) {
      await expect(call(anonymous.api)).rejects.toMatchObject({
        code: "E_UNAUTHENTICATED",
      });
    }
    for (const call of [
      (api: typeof a.api) => api.tasks.cancel({ id: job.id }),
      (api: typeof a.api) => api.tasks.retry({ id: job.id }),
      (api: typeof a.api) => api.tasks.clear({ id: job.id }),
    ])
      await expect(call(b.api)).rejects.toMatchObject({ code: "E_DENIED" });
    await a.api.tasks.cancel({ id: job.id });
    await settle();
    await expect(a.api.tasks.retry({ id: job.id })).resolves.toEqual({
      ok: true,
    });
    await a.api.tasks.cancel({ id: job.id });
    await a.api.tasks.clear({ id: job.id });
    expect(kernel.jobs.get(job.id)?.deleted).toBe(true);
    await expect(a.api.tasks.clear({})).resolves.toEqual({ ok: true });
    await expect(
      a.api.tasks.cancel({ id: createUlid()() }),
    ).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  });
});
