import { inflateRawSync } from "node:zlib";
import { afterEach, expect, it } from "vitest";
import { createUlid, deferred, fromBase64Url } from "@talos/base";
import {
  createApi,
  MAX_HEADER_BYTES,
  MAX_SYNC_BYTES,
  syncResultSchema,
} from "@talos/contract";
import type { LearningCorpus } from "@talos/contract";
import { createMemoryCarrierPair, LinkClient } from "@talos/link";
import { createMemoryObjectStore } from "@talos/objectstore";
import { createKernel } from "./app/create-application.ts";
import type { Kernel } from "./app/create-application.ts";
import { Db } from "./kernel/persistence/db.ts";
import type { SyncResponse } from "./kernel/sync/sync-hub.ts";

const kernels: Kernel[] = [];
const clients: LinkClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((client) => client.stop());
  for (const kernel of kernels.splice(0)) {
    await kernel.close();
    kernel.db.close();
  }
});
async function setup() {
  const kernel = createKernel({
    db: new Db(),
    store: createMemoryObjectStore(),
    build: "test",
    dev: true,
    testSeed: true,
  });
  kernels.push(kernel);
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
  const session = await api.auth.login({ pin: "654321" });
  if ("onboarding" in session) throw new Error("unexpected onboarding");
  return { kernel, client, api, user: session.user.id };
}
async function pullAll(
  api: ReturnType<typeof createApi>,
  cursors: Record<string, number> = {},
) {
  const rows = new Map<string, Map<string, unknown>>();
  let fragments = 0;
  for (let n = 0; n < 100; n++) {
    let page = await api.sync.pull({ cursors });
    if (page.transfer) {
      const chunks: string[] = [];
      for (;;) {
        expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(
          MAX_SYNC_BYTES,
        );
        // Include realistic link reply envelope overhead in the bound.
        expect(
          Buffer.byteLength(
            JSON.stringify({ kind: "reply", id: 12345678, data: page }),
          ),
        ).toBeLessThan(MAX_HEADER_BYTES);
        chunks.push(page.transfer!.chunk);
        fragments++;
        if (!page.transfer!.more) break;
        page = await api.sync.pull({
          cursors,
          continuation: page.transfer!.token,
        });
      }
      const repull = page.repull;
      page = syncResultSchema.parse(JSON.parse(chunks.join("")));
      if (repull)
        for (const scope of Object.values(page.scopes)) scope.more = true;
    }
    for (const [scope, delta] of Object.entries(page.scopes)) {
      const received = rows.get(scope) ?? new Map<string, unknown>();
      rows.set(scope, received);
      delta.rows.forEach((row) => received.set(`${row.type}:${row.id}`, row));
      cursors[scope] = delta.cursor;
    }
    if (Object.values(page.scopes).every((scope) => !scope.more))
      return { rows, cursors, fragments };
  }
  throw new Error("sync failed to converge");
}

it("syncs a legal 1000-document library transaction over bounded real link replies and recovers its oversized push", async () => {
  const { kernel, api, client, user } = await setup();
  const collection = kernel.library.createCollection(user, "大书单");
  const id = createUlid();
  const docs = Array.from({ length: 1000 }, () => id());
  kernel.uow.write((ctx) => {
    for (const doc of docs)
      kernel.library.repo.putDoc(
        {
          id: doc,
          owner: user,
          title: "汉字😀".repeat(50),
          created: 1,
          kind: "flow",
          status: "ready",
          pack: { id: "a".repeat(64), size: 100 },
          units: 1,
          chars: 100,
        },
        "",
        "",
        ctx.rev,
      );
  });
  const before = await pullAll(api);
  expect(before.fragments).toBeGreaterThan(1);
  const events: SyncResponse[] = [];
  client.on("sync.delta", (event) => events.push(event.data as SyncResponse));
  kernel.library.setItems(collection, docs);
  await api.sys.time({});
  expect(events.some((event) => event.repull)).toBe(true);
  expect(
    events.every(
      (event) => Buffer.byteLength(JSON.stringify(event)) <= MAX_SYNC_BYTES,
    ),
  ).toBe(true);
  const after = await pullAll(api, before.cursors);
  expect(after.fragments).toBeGreaterThan(1);
  const received = after.rows.get(`coll:${collection}`)!;
  expect(docs.every((doc) => received.has(`libraryDoc:${doc}`))).toBe(true);
  expect(received.get(`libraryCollection:${collection}`)).toMatchObject({
    data: { docs },
  });
});

it("syncs an allowed corpus above the link header limit without blocking other scopes", async () => {
  const { kernel, api } = await setup();
  let random = 123456;
  const definition = () =>
    Array.from({ length: 1000 }, () => {
      random ^= random << 13;
      random ^= random >>> 17;
      random ^= random << 5;
      return String.fromCharCode(97 + ((random >>> 0) % 26));
    }).join("");
  for (let batch = 0; batch < 4; batch++) {
    const text = Array.from(
      { length: 100 },
      (_, i) => `word-${batch}-${i}#${definition()}`,
    ).join("￥");
    expect(kernel.learning.import(text).imported).toBe(100);
  }
  const corpus = kernel.learning.repo.corpus()!.data as LearningCorpus;
  expect(corpus.data.length).toBeGreaterThan(MAX_HEADER_BYTES);
  const pulled = await pullAll(api);
  expect(pulled.fragments).toBeGreaterThan(1);
  const received = pulled.rows
    .get("learn")!
    .get(`learningCorpus:${corpus.id}`) as { data: LearningCorpus };
  expect(received.data).toEqual(corpus);
  const words = JSON.parse(
    inflateRawSync(fromBase64Url(received.data.data)).toString(),
  ) as unknown[];
  expect(words).toHaveLength(400);
  expect(pulled.rows.size).toBeGreaterThan(1);
});
