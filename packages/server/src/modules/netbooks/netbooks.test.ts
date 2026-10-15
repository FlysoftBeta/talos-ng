import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError, deferred } from "@talos/base";
import { createMemoryObjectStore } from "@talos/objectstore";
import { createMemoryCarrierPair, LinkClient } from "@talos/link";
import { createApi } from "@talos/contract";
import { createKernel } from "../../app/create-application.ts";
import type { Kernel, KernelOptions } from "../../app/create-application.ts";
import { Db } from "../../kernel/persistence/db.ts";
import { FakeNetbooksProvider } from "./provider.ts";
import { TomatoProvider, decode } from "./tomato.ts";
const kernels: Kernel[] = [],
  clients: LinkClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.stop());
  for (const k of kernels.splice(0)) {
    await k.close();
    k.db.close();
  }
});
function setup(extra: Partial<KernelOptions> = {}): Kernel {
  const k = createKernel({
    db: new Db(),
    store: createMemoryObjectStore(),
    build: "test",
    dev: true,
    testSeed: true,
    netbooksWait: async () => {},
    ...extra,
  });
  kernels.push(k);
  return k;
}
async function connect(k: Kernel, pin = "123456") {
  const ready = deferred<void>();
  const client = new LinkClient({
    connect: async () => {
      const p = createMemoryCarrierPair();
      k.host.link.accept(p.b, {});
      return p.a;
    },
    hello: () => ({ v: 1, build: "test", device: null, lang: "zh-CN" }),
  });
  clients.push(client);
  client.onWelcome(() => ready.resolve());
  client.start();
  await ready.promise;
  const api = createApi(client.call.bind(client));
  await api.auth.device.register({});
  const session = await api.auth.login({ pin });
  if ("onboarding" in session) throw Error("onboarding");
  return { api, user: session.user };
}
async function done(k: Kernel, id: string) {
  await vi.waitFor(() => expect(k.jobs.get(id)?.state).toBe("done"), {
    interval: 5,
    timeout: 20_000,
  });
}
describe("netbooks durable flow", () => {
  it("searches author/book, rejects busy with authoritative retry time and empty queries", async () => {
    const k = setup(),
      { api } = await connect(k);
    expect(
      (await api.netbooks.search({ query: "测试作者" })).books[0]?.title,
    ).toBe("星河漫游");
    await expect(api.netbooks.search({ query: "星河" })).rejects.toMatchObject({
      code: "E_BUSY",
      data: { retryAt: expect.any(Number), serverTime: expect.any(Number) },
    });
    await expect(api.netbooks.search({ query: " " })).rejects.toMatchObject({
      code: "E_INVALID",
    });
  });
  it("deduplicates active requests and publishes a readable document into the selected collection", async () => {
    const release = deferred<void>();
    const k = setup({ netbooksWait: async () => release.promise }),
      { api, user } = await connect(k);
    const { id: collection } = await api.library.collection.create({
      title: "网络小说",
    });
    const [a, b] = await Promise.all([
      api.netbooks.download({ book: "10001", collection }),
      api.netbooks.download({ book: "10001", collection }),
    ]);
    expect(b).toEqual({ job: a.job, joined: true });
    release.resolve();
    await done(k, a.job);
    const doc = (k.jobs.get(a.job)!.result as { doc: string }).doc;
    const conversion = k.jobs
      .list(user.id)
      .find((j) => j.kind === "library.convert")!;
    await done(k, conversion.id);
    expect((await api.library.doc.open({ doc })).document.title).toBe(
      "星河漫游",
    );
    expect(k.library.collection(collection).docs).toEqual([doc]);
    expect(k.db.all("SELECT * FROM netbooks_chapters")).toHaveLength(0);
  });
  it("retries transient chapters with exponential delays and preserves sequential order", async () => {
    const provider = new FakeNetbooksProvider(),
      calls: string[] = [],
      waits: number[] = [];
    let failures = 0;
    const original = provider.chapter.bind(provider);
    provider.chapter = async (id) => {
      calls.push(id);
      if (id === "20002" && failures++ < 2)
        throw new AppError("E_UNAVAILABLE", "temporary");
      return original(id);
    };
    const k = setup({
        netbooksProvider: provider,
        netbooksWait: async (ms) => {
          waits.push(ms);
        },
      }),
      { user } = await connect(k);
    const collection = k.library.createCollection(user.id, "重试");
    const result = k.netbooks.download(user.id, "10001", collection);
    await done(k, result.job);
    expect(calls.slice(0, 4)).toEqual(["20001", "20002", "20002", "20002"]);
    expect(waits).toContain(800);
    expect(waits).toContain(1600);
  });
  it("resumes checkpointed chapters on reboot and does not fetch completed chapters again", async () => {
    const provider = new FakeNetbooksProvider(),
      seen: string[] = [];
    const original = provider.chapter.bind(provider);
    provider.chapter = async (id) => {
      seen.push(id);
      return original(id);
    };
    const paused = deferred<void>();
    let waits = 0;
    const k = setup({
      netbooksProvider: provider,
      netbooksWait: async (_, signal) => {
        if (++waits === 2) {
          paused.resolve();
          await new Promise<void>((_, reject) =>
            signal.addEventListener("abort", () =>
              reject(new AppError("E_CANCELLED", "stop")),
            ),
          );
        }
      },
    });
    const { user } = await connect(k);
    const collection = k.library.createCollection(user.id, "恢复");
    const result = k.netbooks.download(user.id, "10001", collection);
    await paused.promise;
    expect(k.netbooks.repo.chapter(result.job, 0)).toBeDefined();
    await k.close();
    kernels.splice(kernels.indexOf(k), 1);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const resumed = setup({
      db: k.db,
      store: k.store,
      netbooksProvider: provider,
    });
    await done(resumed, result.job);
    expect(seen.filter((id) => id === "20001")).toHaveLength(1);
    expect(resumed.jobs.get(result.job)?.attempts).toBe(2);
  });
  it("rejects missing targets and denied entitlement before enqueue", async () => {
    const k = setup(),
      { api, user } = await connect(k);
    await expect(
      api.netbooks.download({ book: "10001", collection: user.id }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    const demo = await connect(k, "654321");
    k.authority.setAccess(demo.user.id, { features: [] });
    await expect(
      demo.api.netbooks.search({ query: "星河" }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
  });
  it("fails permanently invalid chapters without publishing, then retries from saved checkpoint", async () => {
    const provider = new FakeNetbooksProvider(),
      original = provider.chapter.bind(provider);
    let broken = true;
    provider.chapter = async (id) => {
      if (id === "20002" && broken) throw new AppError("E_INVALID", "坏章节");
      return original(id);
    };
    const k = setup({ netbooksProvider: provider }),
      { user } = await connect(k);
    const collection = k.library.createCollection(user.id, "失败");
    const { job } = k.netbooks.download(user.id, "10001", collection);
    await vi.waitFor(() => expect(k.jobs.get(job)?.state).toBe("failed"), {
      interval: 5,
      timeout: 20_000,
    });
    expect(k.library.collection(collection).docs).toEqual([]);
    broken = false;
    k.jobs.retry(user.id, job);
    await done(k, job);
    expect(k.library.collection(collection).docs).toHaveLength(1);
  });
});
it("coalesces task retry with a newer active download into one document", async () => {
  const provider = new FakeNetbooksProvider(),
    original = provider.chapter.bind(provider),
    release = deferred<void>(),
    entered = deferred<void>();
  let broken = true,
    block = false;
  provider.chapter = async (id) => {
    if (broken && id === "20002")
      throw new AppError("E_INVALID", "bad chapter");
    return original(id);
  };
  const k = setup({
      netbooksProvider: provider,
      netbooksWait: async () => {
        if (block) {
          entered.resolve();
          await release.promise;
        }
      },
    }),
    { user } = await connect(k);
  const collection = k.library.createCollection(user.id, "合并重试"),
    first = k.netbooks.download(user.id, "10001", collection);
  await vi.waitFor(() => expect(k.jobs.get(first.job)?.state).toBe("failed"), {
    interval: 5,
    timeout: 20_000,
  });
  broken = false;
  block = true;
  const second = k.netbooks.download(user.id, "10001", collection);
  await entered.promise;
  k.jobs.retry(user.id, first.job);
  block = false;
  release.resolve();
  await done(k, second.job);
  await done(k, first.job);
  expect(k.jobs.get(first.job)?.result).toEqual(k.jobs.get(second.job)?.result);
  expect(k.library.collection(collection).docs).toHaveLength(1);
  expect(k.db.all("SELECT * FROM netbooks_chapters")).toHaveLength(0);
});

describe("netbooks cancellation and publication guards", () => {
  it("cancels during pacing without publishing a document", async () => {
    const entered = deferred<void>();
    const k = setup({
      netbooksWait: async (_, signal) => {
        entered.resolve();
        await new Promise<void>((_, reject) =>
          signal.addEventListener("abort", () =>
            reject(new AppError("E_CANCELLED", "stop")),
          ),
        );
      },
    });
    const { user } = await connect(k);
    const collection = k.library.createCollection(user.id, "取消");
    const { job } = k.netbooks.download(user.id, "10001", collection);
    await entered.promise;
    k.jobs.cancel(user.id, job);
    await vi.waitFor(() => expect(k.jobs.get(job)?.state).toBe("cancelled"), {
      interval: 5,
      timeout: 20_000,
    });
    expect(k.library.collection(collection).docs).toEqual([]);
  });
  it("rechecks entitlement before a resumed chapter and fails without publication", async () => {
    const release = deferred<void>(),
      entered = deferred<void>();
    const k = setup({
      netbooksWait: async () => {
        entered.resolve();
        await release.promise;
      },
    });
    const { user } = await connect(k, "654321");
    k.authority.setAccess(user.id, {
      features: ["article_download", "articles"],
    });
    const collection = k.library.createCollection(user.id, "权限");
    const { job } = k.netbooks.download(user.id, "10001", collection);
    await entered.promise;
    k.authority.setAccess(user.id, { features: [] });
    release.resolve();
    await vi.waitFor(() => expect(k.jobs.get(job)?.state).toBe("failed"), {
      interval: 5,
      timeout: 20_000,
    });
    expect(k.jobs.get(job)?.error?.code).toBe("E_DENIED");
    expect(k.library.collection(collection).docs).toEqual([]);
  });
  it("purge hook removes per-user checkpoints before deleting identity", async () => {
    const k = setup(),
      { user } = await connect(k, "654321");
    const collection = k.library.createCollection(user.id, "清除");
    k.authority.setAccess(user.id, {
      features: ["article_download", "articles"],
    });
    const { job } = k.netbooks.download(user.id, "10001", collection);
    await done(k, job);
    const root = await connect(k);
    const result = await root.api.admin.user.purge({ id: user.id });
    await done(k, result.jobId);
    expect(
      k.db.all("SELECT * FROM netbooks_downloads WHERE user_id=?", user.id),
    ).toEqual([]);
    expect(k.db.all("SELECT * FROM netbooks_chapters")).toEqual([]);
  });
});

describe("tomato HTTP adapter", () => {
  it("parses and decodes catalog and full chapters", async () => {
    const provider = new TomatoProvider(
      async (url) =>
        new Response(
          String(url).includes("/page/")
            ? '<h1>书名</h1><div class="chapter"><a href="/reader/20001">第一章</a><a href="/reader/20001">重复</a></div>'
            : '<div class="muye-reader-content"><p>完整内容</p><p>第二段</p></div>',
        ),
    );
    expect(
      (await provider.catalog("10001", new AbortController().signal)).chapters,
    ).toHaveLength(1);
    expect(await provider.chapter("20001", new AbortController().signal)).toBe(
      "完整内容\n第二段",
    );
    expect(decode("普通文字")).toBe("普通文字");
  });
  it("rejects preview-only, empty, invalid JSON and HTTP failures", async () => {
    for (const body of [
      "",
      '<div class="muye-reader-content">会员登录后，可网页畅读全文</div>',
    ]) {
      const provider = new TomatoProvider(async () => new Response(body));
      await expect(
        provider.chapter("1", new AbortController().signal),
      ).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
    }
    const provider = new TomatoProvider(async () => new Response("verify"));
    await expect(
      provider.search("书", new AbortController().signal),
    ).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
  });
  it("honours upstream rate limit retry timestamp", async () => {
    const provider = new TomatoProvider(
      async () =>
        new Response("", { status: 429, headers: { "retry-after": "12" } }),
      () => 1000,
    );
    await expect(
      provider.search("书", new AbortController().signal),
    ).rejects.toMatchObject({ code: "E_BUSY", data: { retryAt: 13000 } });
  });
  it("normalizes search results with bounded abstracts", async () => {
    const provider = new TomatoProvider(async () =>
      Response.json({
        data: {
          search_book_data_list: [
            {
              book_id: "123",
              book_name: "标题",
              author: "作者",
              book_abstract: "字".repeat(150),
            },
          ],
        },
      }),
    );
    const books = await provider.search("作者", new AbortController().signal);
    expect(books[0]?.abstract.length).toBe(80);
  });
  it.skipIf(process.env.TALOS_NETBOOKS_LIVE !== "1")(
    "opt-in live official provider smoke",
    async () => {
      const provider = new TomatoProvider();
      const books = await provider.search("三体", new AbortController().signal);
      expect(books.length).toBeGreaterThan(0);
      const catalog = await provider.catalog(
        books[0]!.id,
        new AbortController().signal,
      );
      expect(
        await provider.chapter(
          catalog.chapters[0]!.id,
          new AbortController().signal,
        ),
      ).not.toBe("");
    },
    60000,
  );
});
