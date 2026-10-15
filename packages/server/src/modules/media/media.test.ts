import { afterEach, describe, expect, it, vi } from "vitest";
import { createUlid, deferred } from "@talos/base";
import { createApi } from "@talos/contract";
import { createMemoryCarrierPair, LinkClient } from "@talos/link";
import { createMemoryObjectStore } from "@talos/objectstore";
import { Db } from "../../kernel/persistence/db.ts";
import { createKernel } from "../../app/create-application.ts";
import type { Kernel } from "../../app/create-application.ts";
import { FakeMediaProvider } from "./provider.ts";
const ids = createUlid()();
const kernels: Kernel[] = [];
const clients: LinkClient[] = [];
const wav = (() => {
  const bytes = new Uint8Array(44 + 800);
  const view = new DataView(bytes.buffer);
  ["RIFF", "WAVE", "fmt ", "data"].forEach((text, i) => {
    const start = [0, 8, 12, 36][i]!;
    for (let j = 0; j < 4; j++) bytes[start + j] = text.charCodeAt(j);
  });
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  view.setUint32(40, 800, true);
  bytes.fill(128, 44);
  return bytes;
})();
afterEach(async () => {
  clients.splice(0).forEach((v) => v.stop());
  for (const k of kernels.splice(0)) {
    await k.close();
    k.db.close();
  }
});
function setup(now = () => 1_000_000): {
  kernel: Kernel;
  provider: FakeMediaProvider;
} {
  const provider = new FakeMediaProvider();
  provider.add(
    {
      source: "fake",
      providerId: "one",
      title: "晨光",
      artists: ["测试艺人"],
      album: null,
      durationMs: 100,
      url: "fake://one",
    },
    wav,
  );
  provider.add(
    {
      source: "fake",
      providerId: "two",
      title: "夜色",
      artists: ["测试艺人"],
      album: null,
      durationMs: 100,
      url: "fake://two",
    },
    wav,
  );
  const kernel = createKernel({
    db: new Db(),
    store: createMemoryObjectStore(),
    build: "test",
    dev: true,
    testSeed: true,
    mediaProvider: provider,
    clock: {
      now,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    },
  });
  kernels.push(kernel);
  return { kernel, provider };
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
  await api.auth.device.register({});
  const login = await api.auth.login({ pin });
  if ("onboarding" in login) throw Error("onboarding");
  return { api, user: login.user };
}
describe("media module", () => {
  it("deduplicates active materialisation and rolls enqueue back with its outer UoW", async () => {
    const { kernel } = setup();
    const { user } = await connect(kernel);
    const first = await kernel.media.resolve("fake", "one", user.id);
    const second = await kernel.media.resolve("fake", "two", user.id);
    const a = kernel.media.prepare(user.id, first.id);
    const b = kernel.media.prepare(user.id, first.id);
    expect(b.job).toBe(a.job);
    expect(kernel.jobs.activeJobs("media.materialise")).toHaveLength(1);
    expect(() =>
      kernel.uow.write(() => {
        kernel.media.prepare(user.id, second.id);
        throw new Error("rollback materialisation");
      }),
    ).toThrow("rollback materialisation");
    expect(
      kernel.jobs.activeJobs("media.materialise").map((job) => job.id),
    ).toEqual([a.job]);
    await vi.waitFor(
      () => expect(kernel.jobs.get(a.job!)?.state).toBe("done"),
      { timeout: 20_000 },
    );
    expect(kernel.jobs.activeJobs("media.materialise")).toEqual([]);
  });

  it("searches, materialises with an object ref, and issues an audio ticket", async () => {
    const { kernel } = setup();
    const { api, user } = await connect(kernel);
    const tracks = (await api.media.search({ query: "晨光" })).tracks;
    expect(tracks).toHaveLength(1);
    const first = await api.media.track.play({ track: tracks[0]!.id });
    expect(first.job).not.toBeNull();
    await vi.waitFor(
      () => expect(kernel.jobs.get(first.job!)?.state).toBe("done"),
      { timeout: 20_000, interval: 5 },
    );
    const ready = await api.media.track.play({ track: tracks[0]!.id });
    expect(ready.track.audio?.size).toBe(wav.length);
    expect(ready.download?.url).toContain("/dl/");
    expect(
      kernel.db.all("SELECT * FROM object_refs WHERE owner_kind='media.audio'"),
    ).toHaveLength(1);
    expect((await api.media.library.get({})).state.recents).toEqual([
      tracks[0]!.id,
    ]);
    expect(user.id).toBeTruthy();
  });
  it("converges queued favourites and queue stamps, rejects duplicate membership, and shares a playlist", async () => {
    const { kernel } = setup();
    const a = await connect(kernel);
    const b = await connect(kernel, "123456");
    const tracks = (await a.api.media.search({ query: "测试艺人" })).tracks;
    const one = tracks[0]!.id,
      two = tracks[1]!.id;
    const newer = { t: { ms: 20, counter: 0 }, op: ids };
    const older = { t: { ms: 10, counter: 0 }, op: ids };
    await a.api.media.favorite.set({
      track: one,
      value: { v: true, ...newer },
    });
    await a.api.media.favorite.set({
      track: one,
      value: { v: false, ...older },
    });
    expect((await a.api.media.library.get({})).state.favorites[one]?.v).toBe(
      true,
    );
    await a.api.media.queue.set({ tracks: [one, two], ...newer });
    await a.api.media.queue.set({ tracks: [], ...older });
    expect((await a.api.media.library.get({})).state.queue).toEqual([one, two]);
    await expect(
      a.api.media.queue.set({
        tracks: [one, one],
        t: { ms: 21, counter: 0 },
        op: ids,
      }),
    ).rejects.toMatchObject({ code: "E_INVALID" });
    const playlist = (await a.api.media.playlist.create({ title: "共享歌单" }))
      .playlist;
    await a.api.media.playlist.items({
      playlist: playlist.id,
      tracks: [one, two],
    });
    await a.api.media.playlist.share({
      playlist: playlist.id,
      principalType: "user",
      principal: b.user.id,
      level: "read",
      delegate: false,
    });
    expect(
      (await b.api.media.library.get({})).playlists.some(
        (p) => p.id === playlist.id,
      ),
    ).toBe(true);
    await expect(
      b.api.media.playlist.delete({ playlist: playlist.id }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await a.api.media.playlist.retention({ playlist: playlist.id, days: 365 });
    expect(kernel.media.playlist(playlist.id).retentionDays).toBe(365);
  });
  it("prevents playlist delegates from downgrading stronger grants, revoking access or changing the owner", async () => {
    const { kernel } = setup();
    const a = await connect(kernel);
    const b = await connect(kernel, "123456");
    const c = kernel.identity.createUser({
      handle: "third",
      name: "第三人",
      pin: "112233",
    });
    const playlist = (await a.api.media.playlist.create({ title: "权限边界" }))
      .playlist.id;
    const share = (
      principal: string,
      level: "read" | "write" | "own" | null,
      delegate = false,
    ) => ({
      playlist,
      principalType: "user" as const,
      principal,
      level,
      delegate,
    });
    await a.api.media.playlist.share(share(b.user.id, "write", true));
    await a.api.media.playlist.share(share(c.id, "own"));
    await expect(
      b.api.media.playlist.share(share(c.id, "read")),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await expect(
      b.api.media.playlist.share(share(c.id, null)),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await expect(
      a.api.media.playlist.share(share(a.user.id, null)),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await a.api.media.playlist.share(share(c.id, "read"));
    await b.api.media.playlist.share(share(c.id, "write"));
    await a.api.media.playlist.share(share(c.id, null));
    expect(
      (await a.api.media.playlist.grants({ playlist })).grants.some(
        (g) => g.principal === c.id,
      ),
    ).toBe(false);
  });
  it("evicts old server audio while preserving playlist metadata", async () => {
    let now = 1_000_000;
    const { kernel } = setup(() => now);
    const { api } = await connect(kernel);
    const track = (await api.media.search({ query: "晨光" })).tracks[0]!;
    const first = await api.media.track.play({ track: track.id });
    await vi.waitFor(
      () => expect(kernel.jobs.get(first.job!)?.state).toBe("done"),
      { timeout: 20_000, interval: 5 },
    );
    const playlist = (await api.media.playlist.create({ title: "保留" }))
      .playlist;
    await api.media.playlist.items({
      playlist: playlist.id,
      tracks: [track.id],
    });
    expect(kernel.media.evict(1)).toBe(0);
    now += 2 * 86400000;
    expect(kernel.media.evict(1)).toBe(1);
    expect(kernel.media.track(track.id).audio).toBeNull();
    expect(kernel.media.playlist(playlist.id).tracks).toContain(track.id);
  });
});

it("requires current paths, prevents redistribution, revokes ticket/state access on grant or membership loss and survives restart", async () => {
  const { kernel } = setup();
  const owner = await connect(kernel, "123456");
  const guest = await connect(kernel);
  await owner.api.sync.pull({ cursors: {} });
  await guest.api.sync.pull({ cursors: {} });
  const track = (await owner.api.media.search({ query: "晨光" })).tracks[0]!;
  await expect(
    guest.api.media.track.play({ track: track.id }),
  ).rejects.toMatchObject({ code: "E_DENIED" });
  const list = (await owner.api.media.playlist.create({ title: "授权歌单" }))
    .playlist;
  await owner.api.media.playlist.items({
    playlist: list.id,
    tracks: [track.id],
  });
  await owner.api.media.playlist.share({
    playlist: list.id,
    principalType: "user",
    principal: guest.user.id,
    level: "write",
    delegate: false,
  });
  // Nondelegable write access permits editing the existing source playlist.
  await guest.api.media.playlist.items({
    playlist: list.id,
    tracks: [track.id],
  });
  const first = await guest.api.media.track.play({ track: track.id });
  await vi.waitFor(
    () => expect(kernel.jobs.get(first.job!)?.state).toBe("done"),
    { timeout: 20_000 },
  );
  const ready = await guest.api.media.track.play({ track: track.id });
  const op = () => ({ op: createUlid()(), t: { ms: 1_000_000, counter: 0 } });
  await guest.api.media.favorite.set({
    track: track.id,
    value: { v: true, ...op() },
  });
  await guest.api.media.queue.set({ tracks: [track.id], ...op() });
  const copy = (await guest.api.media.playlist.create({ title: "不能复制" }))
    .playlist;
  await expect(
    guest.api.media.playlist.items({ playlist: copy.id, tracks: [track.id] }),
  ).rejects.toMatchObject({ code: "E_DENIED" });
  const before = await guest.api.sync.pull({ cursors: {} });
  expect(
    before.scopes[`me:${guest.user.id}`]?.rows.some(
      (r) => r.type === "mediaTrack" && r.id === track.id,
    ),
  ).toBe(false);
  await owner.api.media.playlist.share({
    playlist: list.id,
    principalType: "user",
    principal: guest.user.id,
    level: null,
    delegate: false,
  });
  await expect(
    kernel.tickets.resolve(ready.download!.ticket),
  ).rejects.toMatchObject({ code: "E_DENIED" });
  for (const run of [
    () => guest.api.media.track.play({ track: track.id }),
    () => guest.api.media.track.prepare({ track: track.id }),
    () =>
      guest.api.media.favorite.set({
        track: track.id,
        value: { v: true, ...op() },
      }),
    () => guest.api.media.queue.set({ tracks: [track.id], ...op() }),
  ])
    await expect(run()).rejects.toMatchObject({ code: "E_DENIED" });
  const deniedLibrary = await guest.api.media.library.get({});
  expect(deniedLibrary.tracks).toEqual([]);
  expect(deniedLibrary.state.queue).toEqual([]);
  expect(deniedLibrary.state.favorites).toEqual({});
  const group = kernel.community.create(owner.user.id, { name: "音乐小组" });
  kernel.community.adminMember(group.id, guest.user.id, "add");
  await owner.api.media.playlist.share({
    playlist: list.id,
    principalType: "group",
    principal: group.id,
    level: "read",
    delegate: false,
  });
  const groupTicket = (await guest.api.media.track.play({ track: track.id }))
    .download!;
  kernel.community.adminMember(group.id, guest.user.id, "kick");
  await expect(
    kernel.tickets.resolve(groupTicket.ticket),
  ).rejects.toMatchObject({ code: "E_DENIED" });
  await expect(
    guest.api.media.track.prepare({ track: track.id }),
  ).rejects.toMatchObject({ code: "E_DENIED" });
  expect(kernel.incidents.list()).toEqual([]);
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "media-restart-"));
  const file = join(dir, "state.sqlite");
  kernel.db.run("VACUUM INTO ?", file);
  const db = new Db(file);
  const restarted = createKernel({
    db,
    store: kernel.media.options.store,
    build: "test",
    mediaProvider: kernel.media.options.provider,
  });
  try {
    const returning = await connect(restarted);
    const returningOwner = await connect(restarted, "123456");
    await expect(
      returning.api.media.track.prepare({ track: track.id }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    expect(
      (await returningOwner.api.media.track.prepare({ track: track.id })).track
        .id,
    ).toBe(track.id);
    await returning.api.media.search({ query: "晨光" });
    expect(
      (await returning.api.media.track.prepare({ track: track.id })).track.id,
    ).toBe(track.id);
  } finally {
    await restarted.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
