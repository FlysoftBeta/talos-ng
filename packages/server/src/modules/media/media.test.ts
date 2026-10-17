import { afterEach, describe, expect, it, vi } from "vitest";
import { createUlid, deferred } from "@talos/base";
import { createApi } from "@talos/contract";
import { createMemoryCarrierPair, LinkClient } from "@talos/link";
import { createMemoryObjectStore } from "@talos/objectstore";
import { Db } from "../../kernel/persistence/db.ts";
import { createKernel } from "../../app/create-application.ts";
import type { Kernel } from "../../app/create-application.ts";
import {
  AUDIO_CACHE_EXPIRY_MS,
  UNREFERENCED_SONG_GRACE_MS,
} from "./retention-policy.ts";
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
  return { api, client, user: login.user };
}
describe("media module", () => {
  it("isolates song and playlist policy and usage for two users, including revoked and restored access", async () => {
    const { kernel: k } = setup();
    const a = await connect(k),
      b = await connect(k, "123456");
    const track = (await a.api.media.search({ query: "晨光" })).tracks[0]!.id;
    const playlist = (await a.api.media.playlist.create({ title: "共享" }))
      .playlist.id;
    await a.api.media.playlist.items({ playlist, tracks: [track] });
    const grant = {
      playlist,
      principalType: "user" as const,
      principal: b.user.id,
      level: "read" as const,
    };
    await a.api.media.playlist.share(grant);
    const id = createUlid(),
      low = id(),
      high = id();
    const value = { v: 7 as const, t: { ms: 100, counter: 0 }, op: high };
    for (const target of [
      { kind: "track" as const, id: track },
      { kind: "playlist" as const, id: playlist },
    ]) {
      await a.api.media.retention.set({ ...target, value });
      expect(
        k.media.retention(b.user.id, target.kind, target.id).value,
      ).toBeNull();
      await b.api.media.retention.set({
        ...target,
        value: { ...value, v: 180 },
      });
      await b.api.media.retention.set({
        ...target,
        value: { ...value, v: 1, op: low },
      });
      await b.api.media.retention.set({
        ...target,
        value: { ...value, v: "auto", t: { ms: 99, counter: 0 } },
      });
      expect(
        k.media.retention(b.user.id, target.kind, target.id).value?.v,
      ).toBe(180);
      expect(
        k.media.retention(a.user.id, target.kind, target.id).value?.v,
      ).toBe(7);
    }
    await b.api.media.track.recordPlay({
      track,
      t: { ms: 200, counter: 0 },
      op: id(),
    });
    await b.api.media.playlist.recordPlay({
      playlist,
      t: { ms: 200, counter: 0 },
      op: id(),
    });
    await b.api.media.playlist.recordPlay({
      playlist,
      t: { ms: 150, counter: 0 },
      op: id(),
    });
    expect(k.media.retention(a.user.id, "track", track).lastUsed).toBe(0);
    expect(k.media.retention(a.user.id, "playlist", playlist).lastUsed).toBe(0);
    expect(k.media.playlist(playlist)).not.toHaveProperty("retentionDays");
    expect(k.media.playlist(playlist)).not.toHaveProperty("lastPlayed");
    const pull = await b.api.sync.pull({ cursors: {} });
    expect(
      pull.scopes[`me:${b.user.id}`]?.rows
        .filter((r) => r.type === "mediaRetention")
        .map((r) => r.data),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: track,
          lastUsed: 200,
          value: expect.objectContaining({ v: 180 }),
        }),
        expect.objectContaining({ id: playlist, lastUsed: 200 }),
      ]),
    );
    expect(
      pull.scopes[`coll:${playlist}`]?.rows.some(
        (r) => r.type === "mediaRetention",
      ),
    ).toBe(false);
    await expect(
      b.client.call("media.retention.set", {
        kind: "track",
        id: track,
        value,
        user: a.user.id,
      }),
    ).rejects.toMatchObject({ code: "E_INVALID" });
    await a.api.media.playlist.share({ ...grant, level: null });
    for (const target of [
      { kind: "track" as const, id: track },
      { kind: "playlist" as const, id: playlist },
    ])
      await expect(
        b.api.media.retention.set({ ...target, value }),
      ).rejects.toMatchObject({ code: "E_DENIED" });
    const revoked = await b.api.sync.pull({ cursors: {} });
    expect(
      revoked.scopes[`me:${b.user.id}`]?.rows.filter(
        (r) => r.type === "mediaRetention" && !r.deleted,
      ),
    ).toHaveLength(2);
    expect(revoked.scopes[`coll:${playlist}`]).toBeUndefined();
    // Regaining direct access through search must preserve the existing policy.
    await b.api.media.search({ query: "晨光" });
    expect(k.media.retention(b.user.id, "track", track).value?.v).toBe(180);
    await a.api.media.playlist.share(grant);
    expect(k.media.retention(b.user.id, "playlist", playlist).value?.v).toBe(
      180,
    );
    await b.api.media.retention.set({
      kind: "track",
      id: track,
      value: { ...value, v: "auto", t: { ms: 300, counter: 0 } },
    });
    expect(k.media.retention(b.user.id, "track", track).value?.v).toBe("auto");
    expect(k.media.retention(b.user.id, "playlist", playlist).value?.v).toBe(
      180,
    );
    await b.api.media.retention.set({
      kind: "track",
      id: track,
      value: { ...value, v: 365, t: { ms: 9_000_000_000_000, counter: 0 } },
    });
    expect(
      k.media.retention(b.user.id, "track", track).value!.t.ms,
    ).toBeLessThanOrEqual(1_000_000 + 5 * 60_000);
  });

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

  it("pages search results, lists playlists and artists, and opens their tracks", async () => {
    const { kernel } = setup();
    const { api } = await connect(kernel);
    const first = await api.media.search({ query: "测试艺人", limit: 1 });
    expect(first.tracks).toHaveLength(1);
    expect(first.next).toBe(1);
    const second = await api.media.search({
      query: "测试艺人",
      limit: 1,
      offset: first.next!,
    });
    expect(second.tracks).toHaveLength(1);
    expect(second.next).toBeNull();
    for (const kind of ["playlist", "artist"] as const) {
      const hits = await api.media.search({ query: "测试艺人", kind });
      expect(hits.tracks).toEqual([]);
      const c = hits.collections[0]!;
      expect(c.kind).toBe(kind);
      const opened = await api.media.collection.open({ kind, id: c.id });
      expect(opened.tracks.length).toBeGreaterThan(0);
    }
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
    });
    expect(
      (await b.api.media.library.get({})).playlists.some(
        (p) => p.id === playlist.id,
      ),
    ).toBe(true);
    await expect(
      b.api.media.playlist.delete({ playlist: playlist.id }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await a.api.media.retention.set({
      kind: "playlist",
      id: playlist.id,
      value: { v: 365, ...newer },
    });
    expect(
      kernel.media.retention(a.user.id, "playlist", playlist.id).value?.v,
    ).toBe(365);
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
    ) => ({
      playlist,
      principalType: "user" as const,
      principal,
      level,
    });
    await a.api.media.playlist.share(share(b.user.id, "write"));
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
    expect(kernel.media.evict()).toBe(0);
    now += AUDIO_CACHE_EXPIRY_MS - 1;
    expect(kernel.media.evict()).toBe(0);
    now++;
    expect(kernel.media.evict()).toBe(1);
    expect(kernel.media.track(track.id).audio).toBeNull();
    expect(kernel.media.playlist(playlist.id).tracks).toContain(track.id);
  });
});

it("requires current paths, permits copying from accessible playlists, revokes ticket/state access on grant or membership loss and survives restart", async () => {
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
  });
  // Write access permits editing the source; read access is enough to copy.
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
  const copy = (await guest.api.media.playlist.create({ title: "复制歌单" }))
    .playlist;
  await guest.api.media.playlist.items({
    playlist: copy.id,
    tracks: [track.id],
  });
  // Removing the independent copy restores dependence on the original grant.
  await guest.api.media.playlist.delete({ playlist: copy.id });
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

it("exposes no global catalog, requires a source for resolve/copy, and lets readers copy without a transfer flag", async () => {
  const { kernel, provider } = setup();
  const owner = await connect(kernel);
  const root = await connect(kernel, "123456");
  const track = (await owner.api.media.search({ query: "晨光" })).tracks[0]!;
  expect((await owner.api.media.library.get({})).playlists).toEqual([]);
  expect(kernel.media.repo.track(track.id)?.unreferenced_since).toBe(1_000_000);
  const resolve = vi.spyOn(provider, "resolve");
  expect((await root.api.media.library.get({})).tracks).toEqual([]);
  expect((await root.api.media.library.get({})).playlists).toEqual([]);
  const pull = await root.api.sync.pull({ cursors: {} });
  expect(JSON.stringify(pull)).not.toContain(track.id);
  await expect(
    root.api.media.track.resolve({ source: "fake", providerId: "one" }),
  ).rejects.toMatchObject({ code: "E_DENIED" });
  await expect(
    owner.api.media.track.resolve({ source: "fake", providerId: "two" }),
  ).rejects.toMatchObject({ code: "E_DENIED" });
  expect(resolve).not.toHaveBeenCalled();
  const copy = (await root.api.media.playlist.create({ title: "我的副本" }))
    .playlist;
  await expect(
    root.api.media.playlist.items({ playlist: copy.id, tracks: [track.id] }),
  ).rejects.toMatchObject({ code: "E_DENIED" });
  const source = (
    await owner.api.media.playlist.create({ title: "可访问来源" })
  ).playlist;
  await owner.api.media.playlist.items({
    playlist: source.id,
    tracks: [track.id],
  });
  await owner.api.media.playlist.share({
    playlist: source.id,
    principalType: "user",
    principal: root.user.id,
    level: "read",
  });
  expect(
    (await root.api.media.track.resolve({ source: "fake", providerId: "one" }))
      .track.id,
  ).toBe(track.id);
  await root.api.media.playlist.items({
    playlist: copy.id,
    tracks: [track.id],
  });
  const grants = await root.api.media.playlist.grants({ playlist: source.id });
  expect(grants.canShare).toBe(true);
  expect(grants.grants[0]).not.toHaveProperty("delegate");
  await owner.api.media.playlist.share({
    playlist: source.id,
    principalType: "user",
    principal: root.user.id,
    level: null,
  });
  expect(
    (await root.api.media.library.get({})).tracks.map((t) => t.id),
  ).toEqual([track.id]);
  await root.api.media.playlist.delete({ playlist: copy.id });
  expect((await root.api.media.library.get({})).tracks).toEqual([]);
});

it("commits discovery and its grace clock atomically without creating playlists or capping accumulated searches", async () => {
  let now = 1_000_000;
  const { kernel, provider } = setup(() => now);
  const { api, user } = await connect(kernel);
  const commits = vi.spyOn(kernel.syncHub, "committed");
  const put = vi
    .spyOn(kernel.media.repo, "discover")
    .mockImplementationOnce(() => {
      throw new Error("injected discovery failure");
    });
  await expect(
    kernel.media.search(
      { query: "晨光", kind: "song", offset: 0, limit: 20 },
      user.id,
    ),
  ).rejects.toThrow("injected discovery failure");
  expect(kernel.media.repo.tracks()).toEqual([]);
  expect(commits).not.toHaveBeenCalled();
  put.mockRestore();
  const track = (await api.media.search({ query: "晨光" })).tracks[0]!;
  expect(
    kernel.db.get("SELECT rev FROM media_discoveries WHERE track=?", track.id),
  ).toEqual({ rev: kernel.media.repo.track(track.id)!.rev });
  for (let i = 0; i < 501; i++)
    provider.add(
      {
        ...track,
        providerId: `many-${i}`,
        title: "大量结果",
        url: `fake://${i}`,
      },
      wav,
    );
  // The provider is bounded per response, not by the user's accumulated discoveries.
  for (let offset = 0; offset < 501; offset += 50) {
    const all = (
      await provider.search({
        query: "大量结果",
        kind: "song",
        offset: 0,
        limit: 501,
      })
    ).tracks;
    const search = vi.spyOn(provider, "search").mockResolvedValueOnce({
      tracks: all.slice(offset, offset + 50),
      collections: [],
      next: null,
    });
    await api.media.search({ query: "大量结果", limit: 50 });
    search.mockRestore();
  }
  expect(kernel.media.repo.tracks()).toHaveLength(502);
  expect(kernel.media.repo.playlists()).toEqual([]);
  // A library snapshot is not a catalog of discoveries; only personal references and playlists.
  expect((await api.media.library.get({})).tracks).toEqual([]);
  now += UNREFERENCED_SONG_GRACE_MS;
  expect(kernel.media.evict()).toBe(502);
  const scope = `me:${user.id}`;
  let cursor = 0;
  const tombstones = new Set<string>();
  for (;;) {
    const page = kernel.syncHub.pull(user.id, {
      cursors: { [scope]: cursor },
      limit: 50,
    }).scopes[scope]!;
    for (const row of page.rows)
      if (row.type === "mediaTrack" && row.deleted) tombstones.add(row.id);
    cursor = page.cursor;
    if (!page.more) break;
  }
  expect(tombstones.size).toBe(502);
});

it("delays final-reference reclamation to the exact boundary; playback, search and favourites do not extend it", async () => {
  let now = 1_000_000;
  const { kernel } = setup(() => now);
  const { api, user } = await connect(kernel);
  const peer = await connect(kernel, "123456");
  const track = (await api.media.search({ query: "晨光" })).tracks[0]!;
  await peer.api.media.search({ query: "晨光" });
  const list = (await api.media.playlist.create({ title: "保存" })).playlist;
  await api.media.playlist.items({ playlist: list.id, tracks: [track.id] });
  expect(kernel.media.repo.track(track.id)?.unreferenced_since).toBeNull();
  const play = await api.media.track.play({ track: track.id });
  await vi.waitFor(
    () => expect(kernel.jobs.get(play.job!)?.state).toBe("done"),
    { timeout: 20_000, interval: 5 },
  );
  now += 100;
  const removedAt = now;
  await api.media.playlist.items({ playlist: list.id, tracks: [] });
  expect(kernel.media.repo.track(track.id)).toMatchObject({
    deleted: 0,
    unreferenced_since: removedAt,
  });
  now = removedAt + UNREFERENCED_SONG_GRACE_MS - 1;
  await api.auth.login({ pin: "654321" });
  const ready = await api.media.track.play({ track: track.id });
  expect(kernel.media.evict()).toBe(0);
  const stamp = { op: createUlid()(), t: { ms: now, counter: 0 } };
  await api.media.queue.set({ tracks: [track.id], ...stamp });
  await api.media.favorite.set({
    track: track.id,
    value: { v: true, ...stamp },
  });
  await api.media.search({ query: "晨光" });
  await api.media.playlist.items({ playlist: list.id, tracks: [] });
  expect(kernel.media.repo.track(track.id)?.unreferenced_since).toBe(removedAt);
  now++;
  expect(kernel.media.evict()).toBe(1);
  expect(kernel.media.repo.track(track.id)).toMatchObject({
    deleted: 1,
    object_id: null,
  });
  expect(
    kernel.db.all("SELECT * FROM object_refs WHERE owner_kind='media.audio'"),
  ).toEqual([]);
  expect(kernel.media.state(user.id)).toMatchObject({
    favorites: {},
    queue: [],
    recents: [],
  });
  await expect(
    kernel.tickets.resolve(ready.download!.ticket),
  ).rejects.toMatchObject({ code: "E_DENIED" });
  const pull = await api.sync.pull({ cursors: {} });
  expect(
    pull.scopes[`me:${user.id}`]?.rows.find(
      (r) => r.type === "mediaTrack" && r.id === track.id,
    ),
  ).toMatchObject({ deleted: true, data: null });
  expect((await api.media.library.get({})).tracks).toEqual([]);
  const again = (await api.media.search({ query: "晨光" })).tracks[0]!;
  expect(again).toMatchObject({ id: track.id, audio: null });
  expect(kernel.media.repo.track(track.id)?.unreferenced_since).toBe(now);
  // A new search revives only the searching user's discovery, never old peers' access.
  await peer.api.auth.login({ pin: "123456" });
  await expect(
    peer.api.media.track.prepare({ track: track.id }),
  ).rejects.toMatchObject({ code: "E_DENIED" });
  expect(
    (await peer.api.sync.pull({ cursors: {} })).scopes[
      `me:${peer.user.id}`
    ]?.rows.find((r) => r.type === "mediaTrack" && r.id === track.id),
  ).toMatchObject({ deleted: true, data: null });
});

it("reattachment cancels reclamation, survives restart, and a later final removal starts a new grace period", async () => {
  let now = 1_000_000;
  const { kernel } = setup(() => now);
  const { api } = await connect(kernel);
  const track = (await api.media.search({ query: "晨光" })).tracks[0]!;
  const a = (await api.media.playlist.create({ title: "A" })).playlist;
  const b = (await api.media.playlist.create({ title: "B" })).playlist;
  now += UNREFERENCED_SONG_GRACE_MS - 1;
  await api.auth.login({ pin: "654321" });
  await api.media.playlist.items({ playlist: a.id, tracks: [track.id] });
  await api.media.playlist.items({ playlist: b.id, tracks: [track.id] });
  now++;
  expect(kernel.media.evict()).toBe(0);
  await api.media.playlist.delete({ playlist: a.id });
  expect(kernel.media.repo.track(track.id)?.unreferenced_since).toBeNull();
  await api.media.playlist.delete({ playlist: b.id });
  const removedAt = now;
  expect(kernel.media.repo.track(track.id)?.unreferenced_since).toBe(removedAt);
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "media-grace-"));
  const file = join(dir, "state.sqlite");
  kernel.db.run("VACUUM INTO ?", file);
  const db = new Db(file);
  const restarted = createKernel({
    db,
    store: kernel.media.options.store,
    build: "test",
    mediaProvider: kernel.media.options.provider,
    clock: {
      now: () => now,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    },
  });
  try {
    const returning = await connect(restarted);
    expect(restarted.media.repo.track(track.id)?.unreferenced_since).toBe(
      removedAt,
    );
    const c = (await returning.api.media.playlist.create({ title: "C" }))
      .playlist;
    now = removedAt + UNREFERENCED_SONG_GRACE_MS;
    await returning.api.auth.login({ pin: "654321" });
    // Reattachment and maintenance are synchronous writer transactions: a completed reattach wins.
    await returning.api.media.playlist.items({
      playlist: c.id,
      tracks: [track.id],
    });
    expect(restarted.media.evict()).toBe(0);
    await returning.api.media.playlist.delete({ playlist: c.id });
    now += UNREFERENCED_SONG_GRACE_MS - 1;
    expect(restarted.media.evict()).toBe(0);
    now++;
    expect(restarted.media.evict()).toBe(1);
    await returning.api.auth.login({ pin: "654321" });
    await expect(
      returning.api.media.playlist.items({
        playlist: a.id,
        tracks: [track.id],
      }),
    ).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  } finally {
    await restarted.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it.each([false, true])(
  "stale materialisation cannot publish after expiry (rediscovered: %s)",
  async (rediscovered) => {
    let now = 1_000_000;
    const { kernel, provider } = setup(() => now);
    const { api } = await connect(kernel);
    const track = (await api.media.search({ query: "晨光" })).tracks[0]!;
    const entered = deferred<void>(),
      release = deferred<void>();
    const materialise = provider.materialise.bind(provider);
    vi.spyOn(provider, "materialise").mockImplementationOnce(
      async (...args) => {
        entered.resolve();
        await release.promise;
        return materialise(...args);
      },
    );
    const play = await api.media.track.play({ track: track.id });
    await entered.promise;
    try {
      now += UNREFERENCED_SONG_GRACE_MS;
      kernel.media.evict();
      await api.auth.login({ pin: "654321" });
      if (rediscovered) await api.media.search({ query: "晨光" });
    } finally {
      release.resolve();
    }
    await vi.waitFor(
      () =>
        expect(kernel.jobs.get(play.job!)?.state).toBe(
          rediscovered ? "cancelled" : "failed",
        ),
      { timeout: 20_000, interval: 5 },
    );
    if (rediscovered) expect(kernel.media.track(track.id).audio).toBeNull();
    else expect(kernel.media.repo.track(track.id)?.deleted).toBe(1);
    expect(
      kernel.db.all("SELECT * FROM object_refs WHERE owner_kind='media.audio'"),
    ).toEqual([]);
    if (!rediscovered) await api.media.search({ query: "晨光" });
    const fresh = await api.media.track.play({ track: track.id });
    expect(fresh.job).not.toBe(play.job);
    await vi.waitFor(
      () => expect(kernel.jobs.get(fresh.job!)?.state).toBe("done"),
      { timeout: 20_000, interval: 5 },
    );
    expect(kernel.media.track(track.id).audio).not.toBeNull();
  },
);

it("owner purge starts delayed reclamation while surviving copies remain live; scheduled maintenance uses the fixed song grace", async () => {
  let now = 1_000_000;
  const { kernel } = setup(() => now);
  const owner = await connect(kernel);
  const survivor = await connect(kernel, "123456");
  const tracks = (await owner.api.media.search({ query: "测试艺人" })).tracks;
  const original = kernel.media.createPlaylist(owner.user.id, "original");
  kernel.media.updatePlaylist(original.id, { tracks: tracks.map((t) => t.id) });
  const copy = kernel.media.createPlaylist(survivor.user.id, "survives");
  kernel.media.updatePlaylist(copy.id, { tracks: [tracks[0]!.id] });
  now += 100;
  await kernel.purge.run(owner.user.id);
  expect(kernel.media.repo.track(tracks[0]!.id)?.unreferenced_since).toBeNull();
  expect(kernel.media.repo.track(tracks[1]!.id)).toMatchObject({
    deleted: 0,
    unreferenced_since: now,
  });
  now += UNREFERENCED_SONG_GRACE_MS - 1;
  await kernel.maintain();
  expect(kernel.media.repo.track(tracks[1]!.id)?.deleted).toBe(0);
  now++;
  await kernel.maintain();
  expect(kernel.media.repo.track(tracks[1]!.id)?.deleted).toBe(1);
  await survivor.api.auth.login({ pin: "123456" });
  expect(
    (await survivor.api.media.library.get({})).tracks.map((t) => t.id),
  ).toEqual([tracks[0]!.id]);
  expect(kernel.db.all("PRAGMA foreign_key_check")).toEqual([]);
});

it("trusted ingestion assigns its requested playlist atomically and stages untargeted metadata under grace", async () => {
  const { kernel } = setup();
  const { user } = await connect(kernel);
  const target = kernel.media.createPlaylist(user.id, "导入目标");
  const value = {
    id: createUlid()(),
    source: "fake",
    providerId: "imported",
    title: "导入",
    artists: [],
    album: null,
    durationMs: 1000,
    audio: null,
  };
  const put = vi
    .spyOn(kernel.media.repo, "putPlaylist")
    .mockImplementationOnce(() => {
      throw new Error("target write failed");
    });
  expect(() => kernel.media.importTrack(value, 0, target.id)).toThrow(
    "target write failed",
  );
  expect(kernel.media.repo.track(value.id)).toBeUndefined();
  expect(kernel.media.playlist(target.id).tracks).toEqual([]);
  put.mockRestore();
  kernel.media.importTrack(value, 0, target.id);
  expect(kernel.media.repo.track(value.id)?.unreferenced_since).toBeNull();
  expect(kernel.media.playlist(target.id).tracks).toEqual([value.id]);
  kernel.media.importTrack({
    ...value,
    id: createUlid()(),
    providerId: "staged",
  });
  expect(kernel.media.repo.source("fake", "staged")?.unreferenced_since).toBe(
    1_000_000,
  );
});
