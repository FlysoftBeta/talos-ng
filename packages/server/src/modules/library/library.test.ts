import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUlid, deferred, utf8Decode } from "@talos/base";
import {
  createApi,
  emptyLibraryState,
  applyLibraryProgress,
} from "@talos/contract";
import {
  PackReader,
  PackWriter,
  MemorySpool,
  decodeResourceBatch,
  decodeResource,
} from "@talos/docpack";
import { createMemoryCarrierPair, LinkClient } from "@talos/link";
import { createMemoryObjectStore } from "@talos/objectstore";
import { Db } from "../../kernel/persistence/db.ts";
import { createKernel } from "../../app/create-application.ts";
import type { Kernel } from "../../app/create-application.ts";
import { LibraryAccess } from "./access.ts";
const kernels: Kernel[] = [];
const clients: LinkClient[] = [];
const id = createUlid();
afterEach(async () => {
  clients.splice(0).forEach((c) => c.stop());
  for (const k of kernels.splice(0)) {
    await k.close();
    k.db.close();
  }
});
function setup(): Kernel {
  const k = createKernel({
    db: new Db(),
    store: createMemoryObjectStore(),
    build: "test",
    dev: true,
    testSeed: true,
  });
  kernels.push(k);
  return k;
}
async function connect(k: Kernel, pin = "654321") {
  const ready = deferred<void>();
  const client = new LinkClient({
    connect: async () => {
      const pair = createMemoryCarrierPair();
      k.host.link.accept(pair.b, {});
      return pair.a;
    },
    hello: () => ({ v: 1, build: "test", device: null, lang: "zh-CN" }),
  });
  clients.push(client);
  client.onWelcome(() => ready.resolve());
  client.start();
  await ready.promise;
  const api = createApi(client.call.bind(client));
  const { device } = await api.auth.device.register({});
  const session = await api.auth.login({ pin });
  if ("onboarding" in session) throw Error("unexpected onboarding");
  return { api, client, device, user: session.user };
}
async function converted(k: Kernel, job: string): Promise<void> {
  await vi.waitFor(() => expect(k.jobs.get(job)?.state).toBe("done"), {
    timeout: 20_000,
    interval: 5,
  });
}
async function text(k: Kernel, user: string, body = "第一章\n你好，文库。") {
  const result = await k.library.importText(user, { title: "中文文档", body });
  await converted(k, result.job);
  return result.doc;
}
describe("library server", () => {
  it("imports text through durable job, strips manifest offsets and delivers verified framed resources", async () => {
    const k = setup();
    const { api, client } = await connect(k);
    const imported = await api.library.doc.importText({
      title: "测试",
      body: "第一章\n中文 😀\r\n下一行",
    });
    await converted(k, imported.job);
    const opened = await api.library.doc.open({ doc: imported.doc });
    expect(opened.document).toMatchObject({
      kind: "flow",
      status: "ready",
      units: 1,
    });
    const rid = opened.manifest.units[0]!.entry;
    expect(opened.manifest.resources[rid]).not.toHaveProperty("offset");
    const reply = await client.call("library.doc.fetch", {
      doc: imported.doc,
      rids: [rid],
    });
    const resource = decodeResourceBatch(reply.body)[0]!;
    expect(
      utf8Decode(
        decodeResource(resource.enc, resource.bytes, {
          rid,
          size: opened.manifest.resources[rid]!.size,
        }),
      ),
    ).toBe("第一章\n中文 😀\n下一行");
    expect((await k.tickets.resolve(opened.download.ticket)).objectId).toBe(
      opened.pack.id,
    );
  });
  it("describes oversized indexes without putting manifests in the link header", async () => {
    const k = setup();
    const a = await connect(k);
    const b = await connect(k, "123456");
    const doc = await text(k, a.user.id);
    const sink = new MemorySpool();
    const writer = new PackWriter(sink, new MemorySpool(), { kind: "flow" });
    const entry = await writer.addResource(
      new TextEncoder().encode("正文"),
      "text/plain",
    );
    for (let i = 0; i < 3000; i++)
      writer.addUnit({ id: `unit-${i}`, entry, deps: [], chars: 2 });
    await writer.finish();
    const bytes = await sink.read(0, sink.size);
    const row = k.library.repo.doc(doc)!;
    const previous = k.library.document(doc);
    await k.objects.publish(
      () => k.store.put(bytes),
      (pack) => {
        k.objects.removeRef(previous.pack!.id, "library.pack", doc);
        k.objects.addRef(pack.id, "library.pack", doc);
        k.library.repo.putDoc(
          { ...previous, pack, units: 3000, chars: 6000 },
          row.source!,
          row.filename!,
          k.uow.current!.rev,
        );
      },
    );
    await expect(a.api.library.doc.open({ doc })).rejects.toMatchObject({
      code: "E_TOO_LARGE",
    });
    const described = await a.api.library.doc.describe({ doc });
    expect(described).not.toHaveProperty("manifest");
    expect(described.document.units).toBe(3000);
    const ticket = await k.tickets.resolve(described.download.ticket);
    const source = await k.store.open(ticket.objectId);
    try {
      expect((await PackReader.open(source)).manifest.units).toHaveLength(3000);
    } finally {
      await source.close();
    }
    await expect(b.api.library.doc.describe({ doc })).rejects.toMatchObject({
      code: "E_DENIED",
    });
    expect(await a.api.sys.time({})).toHaveProperty("now");
  });
  it("decodes GBK attachment, claims source, and retains source through conversion", async () => {
    const k = setup();
    const { api, user } = await connect(k);
    const data = Uint8Array.from([0xc4, 0xe3, 0xba, 0xc3]);
    const upload = await k.uploads.begin(user.id, {
      kind: "document",
      size: data.length,
    });
    await k.uploads.append(user.id, { id: upload.id, offset: 0 }, data);
    await k.uploads.commit(user.id, { id: upload.id });
    const imported = await api.library.doc.importFile({
      upload: upload.id,
      name: "gbk.txt",
      title: "编码",
    });
    await converted(k, imported.job);
    expect(() => k.uploads.getCommitted(user.id, upload.id)).toThrow();
    const opened = await k.library.open(imported.doc);
    const source = await k.store.open(opened.pack.id);
    const reader = await PackReader.open(source);
    expect(
      utf8Decode(await reader.readDecoded(reader.manifest.units[0]!.entry)),
    ).toBe("你好");
    await source.close();
    expect(
      k.db.all("SELECT * FROM object_refs WHERE owner_id=?", imported.doc),
    ).toHaveLength(2);
  });
  it("checks PDF magic before enqueue even when the filename claims to be text", async () => {
    const k = setup();
    const a = await connect(k);
    k.authority.setAccess(a.user.id, {
      features: a.user.features.filter((feature) => feature !== "ebook_reader"),
    });
    const bytes = new TextEncoder().encode("%PDF-1.7\n");
    const upload = await k.uploads.begin(a.user.id, {
      kind: "document",
      size: bytes.length,
    });
    await k.uploads.append(a.user.id, { id: upload.id, offset: 0 }, bytes);
    await k.uploads.commit(a.user.id, { id: upload.id });
    await expect(
      a.api.library.doc.importFile({
        upload: upload.id,
        name: "hidden.txt",
        title: "文档",
      }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    expect(k.jobs.list(a.user.id)).toHaveLength(0);
  });
  it("preserves failed conversion source and exposes a retryable durable job", async () => {
    const k = setup();
    const { api, user } = await connect(k);
    const bytes = new Uint8Array([1, 2, 3]);
    const upload = await k.uploads.begin(user.id, {
      kind: "document",
      size: 3,
    });
    await k.uploads.append(user.id, { id: upload.id, offset: 0 }, bytes);
    await k.uploads.commit(user.id, { id: upload.id });
    const imported = await api.library.doc.importFile({
      upload: upload.id,
      name: "bad.unknown",
      title: "损坏",
    });
    await vi.waitFor(
      () => expect(k.jobs.get(imported.job)?.state).toBe("failed"),
      { interval: 5, timeout: 20_000 },
    );
    expect(
      k.db.all("SELECT * FROM object_refs WHERE owner_id=?", imported.doc),
    ).toHaveLength(1);
    expect(k.jobs.get(imported.job)?.error).toMatchObject({
      code: "E_INVALID",
    });
  });
  it("shares read then write, forbids privilege escalation, and revokes ticket immediately", async () => {
    const k = setup();
    const a = await connect(k);
    const b = await connect(k, "123456");
    const doc = await text(k, a.user.id);
    const collection = (
      await a.api.library.collection.create({ title: "共享书单" })
    ).id;
    await a.api.library.collection.transfer({
      source: k.library.ensureBuiltins(a.user.id).shelf,
      target: collection,
      doc,
    });
    const grant = {
      collection,
      principalType: "user" as const,
      principal: b.user.id,
      level: "read" as const,
      delegate: false,
    };
    await a.api.library.sharing.set(grant);
    const open = await b.api.library.doc.open({ doc });
    await expect(
      b.api.library.collection.items({ collection, docs: [] }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await expect(
      b.api.library.sharing.set({
        ...grant,
        principal: a.user.id,
        level: "own",
      }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await a.api.library.sharing.set({ ...grant, level: "write" });
    await b.api.library.collection.items({ collection, docs: [doc] });
    await a.api.library.sharing.set({ ...grant, level: null });
    await expect(k.tickets.resolve(open.download.ticket)).rejects.toMatchObject(
      { code: "E_DENIED" },
    );
    await expect(b.api.library.doc.open({ doc })).rejects.toMatchObject({
      code: "E_DENIED",
    });
  });
  it("delegation cannot overwrite stronger grant and original owner cannot be revoked", async () => {
    const k = setup();
    const a = await connect(k);
    const b = await connect(k, "123456");
    const c = k.identity.createUser({
      pin: "222222",
      name: "第三人",
      handle: "third",
    });
    const coll = (await a.api.library.collection.create({ title: "授权" })).id;
    const grant = {
      collection: coll,
      principalType: "user" as const,
      principal: b.user.id,
      level: "write" as const,
      delegate: true,
    };
    await a.api.library.sharing.set(grant);
    await b.api.library.sharing.set({
      ...grant,
      principal: c.id,
      level: "read",
      delegate: false,
    });
    await expect(
      b.api.library.sharing.set({ ...grant, principal: c.id, level: "own" }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await expect(
      a.api.library.sharing.set({
        ...grant,
        principal: a.user.id,
        level: null,
      }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
  });
  it("group membership loss removes collection scope and document authority", async () => {
    const k = setup();
    const a = await connect(k);
    const b = await connect(k, "123456");
    const group = k.community.create(a.user.id, {
      name: "组",
      discoverable: true,
    });
    k.community.join(b.user.id, group.id, { type: "search" });
    const collection = (
      await a.api.library.collection.create({
        title: "组书单",
        group: group.id,
      })
    ).id;
    const doc = await text(k, a.user.id);
    await a.api.library.collection.transfer({
      source: k.library.ensureBuiltins(a.user.id).shelf,
      target: collection,
      doc,
    });
    const initial = await b.api.sync.pull({ cursors: {} });
    expect(initial.added).toContain(`coll:${collection}`);
    k.community.leave(b.user.id, group.id);
    const removed = await b.api.sync.pull({
      cursors: { [`coll:${collection}`]: 0 },
    });
    expect(removed.gone).toContain(`coll:${collection}`);
    await expect(b.api.library.doc.open({ doc })).rejects.toMatchObject({
      code: "E_DENIED",
    });
  });
  it("queues monotonic progress per device and LWW favourites/retention without granting access", async () => {
    const k = setup();
    const a = await connect(k);
    const doc = await text(k, a.user.id);
    const value = {
      v: { unit: 0, offset: 8 },
      t: { ms: 10, counter: 0 },
      op: id(),
    };
    const input = {
      doc,
      resume: value,
      furthest: 8,
      seconds: 10,
      device: a.device,
    };
    await a.api.library.progress.set(input, { op: id() });
    await a.api.library.progress.set(
      {
        ...input,
        resume: {
          ...value,
          v: { unit: 0, offset: 2 },
          t: { ms: 9, counter: 0 },
        },
        seconds: 3,
        furthest: 2,
      },
      { op: id() },
    );
    await a.api.library.favourite.set(
      { doc, value: { ...value, v: true } },
      { op: id() },
    );
    await a.api.library.retention.set(
      { doc, value: { ...value, v: 7 } },
      { op: id() },
    );
    expect(k.library.state(a.user.id, doc)).toMatchObject({
      resume: { v: { offset: 8 } },
      furthest: 8,
      seconds: { [a.device]: 10 },
      favourite: { v: true },
      retention: { v: 7 },
    });
    await expect(
      a.api.library.progress.set({ ...input, device: id() }, { op: id() }),
    ).rejects.toMatchObject({ code: "E_INVALID" });
  });
  it("reorders without duplicates, confirms deletion authority server-side and releases objects", async () => {
    const k = setup();
    const a = await connect(k);
    const b = await connect(k, "123456");
    const first = await text(k, a.user.id);
    const second = await text(k, a.user.id, "第二篇");
    const coll = (await a.api.library.collection.create({ title: "顺序" })).id;
    for (const doc of [second, first])
      await a.api.library.collection.transfer({
        source: k.library.ensureBuiltins(a.user.id).shelf,
        target: coll,
        doc,
      });
    expect(k.library.collection(coll).docs).toEqual([second, first]);
    await expect(
      a.api.library.collection.items({
        collection: coll,
        docs: [first, first],
      }),
    ).rejects.toMatchObject({ code: "E_INVALID" });
    await expect(
      b.api.library.doc.delete({ doc: first }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await a.api.library.doc.delete({ doc: first });
    expect(k.library.collection(coll).docs).toEqual([second]);
    expect(
      k.db.all("SELECT * FROM object_refs WHERE owner_id=?", first),
    ).toHaveLength(0);
    await a.api.library.collection.delete({ collection: coll });
    expect(() => k.library.collection(coll)).toThrow();
  });
  it("delivers removed collection items as durable tombstones after disconnected edits", async () => {
    const k = setup();
    const a = await connect(k);
    const b = await connect(k, "123456");
    const doc = await text(k, a.user.id);
    const coll = k.library.createCollection(a.user.id, "移除");
    k.library.setItems(coll, [doc]);
    k.authority.setGrant({
      resource: `coll:${coll}`,
      principalType: "user",
      principal: b.user.id,
      level: "read",
    });
    const before = await b.api.sync.pull({ cursors: { [`coll:${coll}`]: 0 } });
    const cursor = before.scopes[`coll:${coll}`]!.cursor;
    b.client.stop();
    k.library.setItems(coll, []);
    const resumed = await connect(k, "123456");
    const after = await resumed.api.sync.pull({
      cursors: { [`coll:${coll}`]: cursor },
    });
    expect(after.scopes[`coll:${coll}`]!.rows).toContainEqual(
      expect.objectContaining({
        type: "libraryDoc",
        id: doc,
        deleted: true,
        data: null,
      }),
    );
  });
  it("forbids copying nondelegable shared documents into a new shareable collection", async () => {
    const k = setup();
    const a = await connect(k);
    const b = await connect(k, "123456");
    const doc = await text(k, a.user.id);
    const coll = k.library.createCollection(a.user.id, "只读");
    k.library.setItems(coll, [doc]);
    k.authority.setGrant({
      resource: `coll:${coll}`,
      principalType: "user",
      principal: b.user.id,
      level: "read",
    });
    const target = (await b.api.library.collection.create({ title: "副本" }))
      .id;
    await expect(
      b.api.library.collection.items({ collection: target, docs: [doc] }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await a.api.library.sharing.set({
      collection: coll,
      principalType: "user",
      principal: b.user.id,
      level: "read",
      delegate: true,
    });
    await b.api.library.collection.transfer({ source: coll, target, doc });
  });
  it("requeues persisted interrupted conversion after a database reopen", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "library-restart-"));
    const file = path.join(dir, "db.sqlite");
    const store = createMemoryObjectStore();
    let current = createKernel({
      db: new Db(file),
      store,
      build: "test",
      dev: true,
      testSeed: true,
    });
    try {
      const user = current.authority.repo.users()[0]!;
      const imported = await current.library.importText(user, {
        title: "重启",
        body: "第一章\n仍可阅读",
      });
      await converted(current, imported.job);
      const row = current.library.repo.doc(imported.doc)!;
      const document = current.library.document(imported.doc);
      current.uow.write((ctx) => {
        current.library.repo.putDoc(
          {
            ...document,
            status: "processing",
            pack: null,
            kind: null,
            units: 0,
            chars: 0,
          },
          row.source!,
          row.filename!,
          ctx.rev,
        );
        current.objects.removeRef(
          document.pack!.id,
          "library.pack",
          document.id,
        );
        current.db.run(
          "UPDATE jobs SET state='running',progress=0 WHERE id=?",
          imported.job,
        );
      });
      await current.close();
      current.db.close();
      current = createKernel({ db: new Db(file), store, build: "test" });
      await converted(current, imported.job);
      expect(current.jobs.get(imported.job)?.attempts).toBe(2);
      expect((await current.library.open(imported.doc)).document.status).toBe(
        "ready",
      );
    } finally {
      await current.close();
      current.db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("personal progress merge is order-independent and idempotent for distinct operations", () => {
    const doc = id(),
      device = id();
    const writes = Array.from({ length: 50 }, (_, n) => ({
      doc,
      device,
      seconds: n,
      furthest: n * 2,
      resume: { v: { unit: 0, offset: n }, t: { ms: n, counter: 0 }, op: id() },
    }));
    const forward = writes.reduce(applyLibraryProgress, emptyLibraryState(doc));
    const reverse = writes
      .slice()
      .reverse()
      .reduce(applyLibraryProgress, emptyLibraryState(doc));
    expect(forward).toEqual(reverse);
    expect(applyLibraryProgress(forward, writes[49]!)).toEqual(forward);
  });
  it("nondelegable readers cannot create a favourite container", async () => {
    const k = setup();
    const a = await connect(k);
    const b = await connect(k, "123456");
    const doc = await text(k, a.user.id);
    const coll = k.library.createCollection(a.user.id, "有限访问");
    k.library.setItems(coll, [doc]);
    k.authority.setGrant({
      resource: `coll:${coll}`,
      principalType: "user",
      principal: b.user.id,
      level: "read",
    });
    await expect(
      b.api.library.favourite.set(
        { doc, value: { v: true, t: { ms: 1, counter: 0 }, op: id() } },
        { op: id() },
      ),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    k.library.setItems(coll, []);
    expect(
      new LibraryAccess(k.library, k.authority, k.community).document(
        b.user.id,
        doc,
      ),
    ).toBe(false);
    expect(k.library.state(b.user.id, doc).favourite).toBeNull();
  });
});

describe("library container invariants", () => {
  it("provisions exactly two private immutable built-ins, including empty-account sync", async () => {
    const k = setup(),
      a = await connect(k),
      b = await connect(k, "123456");
    const builtins = k.library.ensureBuiltins(a.user.id);
    expect(k.library.ensureBuiltins(a.user.id)).toEqual(builtins);
    const pull = await a.api.sync.pull({ cursors: {} });
    expect(
      pull.scopes[`me:${a.user.id}`]!.rows.filter(
        (r) => r.type === "libraryCollection",
      ).map((r) => (r.data as { title: string }).title),
    ).toEqual(expect.arrayContaining(["我的书架", "我的收藏"]));
    for (const collection of Object.values(builtins)) {
      await expect(
        a.api.library.collection.delete({ collection }),
      ).rejects.toMatchObject({ code: "E_DENIED" });
      await expect(
        a.api.library.sharing.set({
          collection,
          principalType: "user",
          principal: b.user.id,
          level: "read",
          delegate: true,
        }),
      ).rejects.toMatchObject({ code: "E_DENIED" });
      // Even a forged generic grant cannot expose a private built-in to root.
      k.authority.setGrant({
        resource: `coll:${collection}`,
        principalType: "user",
        principal: b.user.id,
        level: "own",
      });
      expect(
        new LibraryAccess(k.library, k.authority, k.community).collection(
          b.user.id,
          collection,
        ),
      ).toBe(false);
      expect((await a.api.library.sharing.list({ collection })).canShare).toBe(
        false,
      );
    }
  });
  it("imports atomically to a selected container or the default shelf; failed targets leave no book or job", async () => {
    const k = setup(),
      a = await connect(k);
    const before = k.library.repo.docs().length;
    await expect(
      k.library.importText(a.user.id, {
        title: "missing",
        body: "text",
        collection: id(),
      }),
    ).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    expect(k.library.repo.docs()).toHaveLength(before);
    const collection = k.library.createCollection(a.user.id, "only container");
    const imported = await a.api.library.doc.importText({
      title: "selected",
      body: "selected",
      collection,
    });
    expect(k.library.collection(collection).docs).toEqual([imported.doc]);
    expect(
      k.library.collection(k.library.ensureBuiltins(a.user.id).shelf).docs,
    ).not.toContain(imported.doc);
    const normal = await a.api.library.doc.importText({
      title: "default",
      body: "default",
    });
    expect(
      k.library.collection(k.library.ensureBuiltins(a.user.id).shelf).docs,
    ).toContain(normal.doc);
  });
  it("rejects destination additions and requires the named source to contain the book and allow transfer", async () => {
    const k = setup(),
      a = await connect(k),
      b = await connect(k, "123456");
    const doc = await text(k, a.user.id),
      source = k.library.createCollection(a.user.id, "source"),
      target = k.library.createCollection(b.user.id, "target");
    k.library.setItems(source, [doc]);
    const grant = {
      collection: source,
      principalType: "user" as const,
      principal: b.user.id,
      level: "read" as const,
      delegate: false,
    };
    await a.api.library.sharing.set(grant);
    await expect(
      a.api.library.collection.items({
        collection: source,
        docs: [doc, await text(k, a.user.id, "other")],
      }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await expect(
      b.api.library.collection.transfer({ source, target, doc }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await a.api.library.sharing.set({ ...grant, delegate: true });
    await expect(
      b.api.library.collection.transfer({ source, target, doc: id() }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await b.api.library.collection.transfer({ source, target, doc });
    await b.api.library.collection.transfer({ source, target, doc });
    expect(k.library.collection(target).docs).toEqual([doc]);
    await a.api.library.sharing.set({ ...grant, level: null });
    expect(
      new LibraryAccess(k.library, k.authority, k.community).document(
        b.user.id,
        doc,
      ),
    ).toBe(true);
    await expect(
      b.api.library.collection.transfer({ source, target, doc }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
  });
  it("favourites are containers: LWW replay, transfer, removal, last-container deletion and state tombstones agree", async () => {
    const k = setup(),
      a = await connect(k);
    const doc = await text(k, a.user.id),
      builtins = k.library.ensureBuiltins(a.user.id);
    const value = { v: true, t: { ms: 20, counter: 0 }, op: id() };
    await a.api.library.favourite.set({ doc, value }, { op: id() });
    await a.api.library.favourite.set(
      { doc, value: { ...value, v: false, t: { ms: 10, counter: 0 } } },
      { op: id() },
    );
    expect(k.library.collection(builtins.favourites).docs).toEqual([doc]);
    await a.api.library.collection.items({
      collection: builtins.shelf,
      docs: [],
    });
    expect(k.library.document(doc).id).toBe(doc);
    const cursor = (await a.api.sync.pull({ cursors: {} })).scopes[
      `me:${a.user.id}`
    ]!.cursor;
    await a.api.library.collection.items({
      collection: builtins.favourites,
      docs: [],
    });
    expect(() => k.library.document(doc)).toThrow();
    expect(k.library.state(a.user.id, doc).favourite).toBeNull();
    expect(k.db.all("SELECT * FROM object_refs WHERE owner_id=?", doc)).toEqual(
      [],
    );
    expect(
      k.jobs
        .list(a.user.id)
        .filter((j) => j.kind === "library.convert" && !j.deleted),
    ).toEqual([]);
    const delta = await a.api.sync.pull({
      cursors: { [`me:${a.user.id}`]: cursor },
    });
    for (const type of ["libraryDoc", "libraryState"])
      expect(delta.scopes[`me:${a.user.id}`]!.rows).toContainEqual(
        expect.objectContaining({ type, id: doc, deleted: true, data: null }),
      );
    await expect(
      a.api.library.favourite.set({ doc, value }, { op: id() }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
  });
  it("deleting a booklist reclaims only its last-contained books, including books owned by another user", async () => {
    const k = setup(),
      a = await connect(k),
      b = await connect(k, "123456");
    const target = k.library.createCollection(b.user.id, "target");
    const sole = await k.library.importText(a.user.id, {
      title: "sole",
      body: "sole",
      collection: target,
    });
    const retained = await text(k, a.user.id);
    k.library.setItems(target, [sole.doc, retained]);
    await b.api.library.collection.delete({ collection: target });
    expect(() => k.library.document(sole.doc)).toThrow();
    expect(k.library.document(retained).id).toBe(retained);
    expect(k.library.repo.items(target).every((item) => item.deleted)).toBe(
      true,
    );
  });
  it("rolls back reclamation, state, refs and memberships with the enclosing transaction", async () => {
    const k = setup(),
      a = await connect(k),
      doc = await text(k, a.user.id),
      shelf = k.library.ensureBuiltins(a.user.id).shelf;
    expect(() =>
      k.uow.write(() => {
        k.library.setItems(shelf, []);
        throw Error("rollback");
      }),
    ).toThrow("rollback");
    expect(k.library.document(doc).id).toBe(doc);
    expect(k.library.collection(shelf).docs).toContain(doc);
    expect(
      k.db.all("SELECT * FROM object_refs WHERE owner_id=?", doc),
    ).toHaveLength(2);
  });
});

describe("library reclamation edges", () => {
  it("reclaims physical objects immediately after commit without deleting deduplicated bytes still in use", async () => {
    const k = setup(),
      a = await connect(k);
    const first = await text(k, a.user.id),
      second = await text(k, a.user.id);
    const source = k.library.repo.doc(first)!.source!,
      pack = k.library.document(first).pack!.id;
    k.library.deleteDoc(first);
    await k.objects.reclaim([source, pack]);
    expect(await k.store.has(source)).toBe(true);
    expect(await k.store.has(pack)).toBe(true);
    k.library.deleteDoc(second);
    await k.objects.reclaim([source, pack]);
    expect(await k.store.has(source)).toBe(false);
    expect(await k.store.has(pack)).toBe(false);
  });
  it("rechecks import authorization at publication after asynchronous storage", async () => {
    const k = setup(),
      a = await connect(k),
      b = await connect(k, "123456");
    const collection = k.library.createCollection(
      a.user.id,
      "revoked while importing",
    );
    const grant = {
      collection,
      principalType: "user" as const,
      principal: b.user.id,
      level: "write" as const,
      delegate: false,
    };
    await a.api.library.sharing.set(grant);
    const entered = deferred<void>(),
      release = deferred<void>();
    const put = k.store.put.bind(k.store);
    vi.spyOn(k.store, "put").mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return put(...args);
    });
    const pending = b.api.library.doc.importText({
      title: "revoked",
      body: "revoked",
      collection,
    });
    const denied = expect(pending).rejects.toMatchObject({ code: "E_DENIED" });
    await entered.promise;
    await a.api.library.sharing.set({ ...grant, level: null });
    release.resolve();
    await denied;
    expect(k.library.collection(collection).docs).toEqual([]);
    expect(k.library.repo.docs()).toEqual([]);
    expect(
      k.jobs.list(b.user.id).filter((j) => j.kind === "library.convert"),
    ).toEqual([]);
  });
  it("cleans source checkpoints, chapters, grants and jobs when their last container is deleted", async () => {
    const k = setup(),
      a = await connect(k),
      b = await connect(k, "123456");
    const collection = k.library.createCollection(a.user.id, "source workflow");
    const doc = await k.library.importText(a.user.id, {
      title: "source",
      body: "source",
      collection,
    });
    await converted(k, doc.job);
    // A source download can retain a publication checkpoint even after conversion finishes.
    const sourceJob = k.jobs.enqueue(a.user.id, "netbooks.download", {
      book: "fixture",
      collection,
    });
    k.db.run(
      "INSERT INTO netbooks_downloads VALUES(?,?,?,?,NULL,?)",
      sourceJob.id,
      a.user.id,
      "fixture",
      collection,
      doc.doc,
    );
    k.db.run(
      "INSERT INTO netbooks_chapters VALUES(?,0,'chapter')",
      sourceJob.id,
    );
    await a.api.library.sharing.set({
      collection,
      principalType: "user",
      principal: b.user.id,
      level: "read",
      delegate: true,
    });
    await a.api.library.collection.delete({ collection });
    expect(
      k.db.all("SELECT * FROM netbooks_downloads WHERE job=?", sourceJob.id),
    ).toEqual([]);
    expect(
      k.db.all("SELECT * FROM netbooks_chapters WHERE job=?", sourceJob.id),
    ).toEqual([]);
    expect(k.jobs.get(sourceJob.id)?.deleted).toBe(true);
    expect(k.authority.repo.grants(`coll:${collection}`)).toEqual([]);
    expect(k.library.repo.delegation(collection, "user", b.user.id)).toBe(
      false,
    );
  });
  it("preserves the container invariant through deterministic mixed detach/delete sequences", async () => {
    const k = setup(),
      a = await connect(k);
    const collections = Array.from({ length: 5 }, (_, i) =>
      k.library.createCollection(a.user.id, `list ${i}`),
    );
    const docs: string[] = [];
    for (let i = 0; i < 12; i++) {
      const imported = await k.library.importText(a.user.id, {
        title: `book ${i}`,
        body: `body ${i}`,
        collection: collections[i % collections.length]!,
      });
      docs.push(imported.doc);
    }
    for (let i = 0; i < 30; i++) {
      const collection = collections[(i * 7) % collections.length]!;
      const current = k.library.collection(collection).docs;
      const candidate = docs[(i * 5) % docs.length]!;
      if (k.library.repo.doc(candidate)?.deleted || current.includes(candidate))
        k.library.setItems(
          collection,
          current.filter((_, index) => index !== 0),
        );
      else k.library.setItems(collection, [...current, candidate]);
      for (const row of k.library.repo.docs()) {
        expect(k.library.repo.hasContainer(row.id)).toBe(!row.deleted);
        if (row.deleted)
          expect(
            k.db.all("SELECT * FROM object_refs WHERE owner_id=?", row.id),
          ).toEqual([]);
      }
    }
    for (const collection of collections)
      k.library.deleteCollection(collection);
    expect(k.library.repo.docs().every((row) => row.deleted)).toBe(true);
  });
});
