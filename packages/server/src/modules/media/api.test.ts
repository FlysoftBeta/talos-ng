// Backend API availability for the music/media feature (task 150 (c)): the real kernel
// assembly behind the real link host; every `media.*` method answers for an entitled user
// and every one is refused for an anonymous or an unentitled account.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUlid, deferred } from "@talos/base";
import { createApi, mediaMethods } from "@talos/contract";
import { createMemoryCarrierPair, LinkClient } from "@talos/link";
import { createMemoryObjectStore } from "@talos/objectstore";
import { createKernel } from "../../app/create-application.ts";
import type { Kernel } from "../../app/create-application.ts";
import { Db } from "../../kernel/persistence/db.ts";
import { FakeMediaProvider } from "./provider.ts";

const stamp = () => ({ t: { ms: Date.now(), counter: 0 }, op: createUlid()() });
const wav = (() => {
  const bytes = new Uint8Array(44 + 80);
  const text = (at: number, value: string) =>
    [...value].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  const view = new DataView(bytes.buffer);
  text(0, "RIFF");
  text(8, "WAVE");
  text(12, "fmt ");
  text(36, "data");
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  view.setUint32(40, 80, true);
  return bytes;
})();

const kernels: Kernel[] = [];
const clients: LinkClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.stop());
  for (const k of kernels.splice(0)) {
    await k.close();
    k.db.close();
  }
});
async function open(kernel: Kernel, called: Set<string>) {
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
  const call: Parameters<typeof createApi>[0] = (method, ...rest) => {
    called.add(method);
    return client.call(method, ...rest);
  };
  return Object.assign(createApi(call), { client });
}

describe("media API availability", () => {
  it("answers every media method for an entitled user", async () => {
    const provider = new FakeMediaProvider();
    provider.add(
      {
        source: "fake",
        providerId: "one",
        title: "晨光",
        artists: ["艺人"],
        album: null,
        durationMs: 100,
        url: "fake://one",
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
    });
    kernels.push(kernel);
    const called = new Set<string>();
    const api = await open(kernel, called);
    await api.auth.device.register({});
    const login = await api.auth.login({ pin: "123456" });
    if (!("user" in login)) throw new Error("expected a session");
    const peer = kernel.identity.createUser({
      handle: "peer",
      name: "同学",
      pin: "112233",
    });

    const [track] = (await api.media.search({ query: "晨光" })).tracks;
    expect(track).toBeDefined();
    const resolved = await api.media.track.resolve({
      source: "fake",
      providerId: "one",
    });
    expect(resolved.track.id).toBe(track!.id);
    const play = await api.media.track.play({ track: track!.id });
    expect(play.maxVolume).toBeGreaterThan(0);
    await vi.waitFor(
      () => expect(kernel.jobs.get(play.job!)?.state).toBe("done"),
      { timeout: 20_000 },
    );
    expect(
      (await api.media.track.prepare({ track: track!.id })).download?.url,
    ).toContain("/dl/");
    await api.media.favorite.set({
      track: track!.id,
      value: { v: true, ...stamp() },
    });
    await api.media.queue.set({ tracks: [track!.id], ...stamp() });
    await api.media.stopAtEnd.set({ value: true, ...stamp() });
    const { playlist } = await api.media.playlist.create({ title: "清单" });
    await api.media.playlist.items({
      playlist: playlist.id,
      tracks: [track!.id],
    });
    await api.media.retention.set({
      kind: "playlist",
      id: playlist.id,
      value: { v: 30, ...stamp() },
    });
    await api.media.track.recordPlay({ track: track!.id, ...stamp() });
    await api.media.playlist.recordPlay({ playlist: playlist.id, ...stamp() });
    await api.media.playlist.share({
      playlist: playlist.id,
      principalType: "user",
      principal: peer.id,
      level: "read",
    });
    const grants = await api.media.playlist.grants({ playlist: playlist.id });
    expect(grants.canShare).toBe(true);
    expect(grants.grants.some((g) => g.principal === peer.id)).toBe(true);
    expect(
      (await api.media.playlist.principals({})).principals.some(
        (p) => p.id === peer.id,
      ),
    ).toBe(true);
    const library = await api.media.library.get({});
    expect(library.state.favorites[track!.id]?.v).toBe(true);
    expect(library.state.queue).toEqual([track!.id]);
    expect(library.playlists.map((p) => p.id)).toContain(playlist.id);
    await api.media.playlist.delete({ playlist: playlist.id });
    // Every method of the feature was exercised: a new method must be added here.
    expect([...called].filter((n) => n.startsWith("media.")).sort()).toEqual(
      mediaMethods.map((m) => m.name).sort(),
    );
  });

  it("refuses every media method to anonymous sessions and to accounts without the media gate", async () => {
    const kernel = createKernel({
      db: new Db(),
      store: createMemoryObjectStore(),
      build: "test",
      dev: true,
      testSeed: true,
      mediaProvider: new FakeMediaProvider(),
    });
    kernels.push(kernel);
    const anonymous = new LinkClient({
      connect: async () => {
        const pair = createMemoryCarrierPair();
        kernel.host.link.accept(pair.b, {});
        return pair.a;
      },
      hello: () => ({ v: 1, build: "test", device: null, lang: "zh-CN" }),
    });
    clients.push(anonymous);
    const ready = deferred<void>();
    anonymous.onWelcome(() => ready.resolve());
    anonymous.start();
    await ready.promise;
    const ordinary = await open(kernel, new Set());
    await ordinary.auth.device.register({});
    const session = await ordinary.auth.login({ pin: "654321" });
    if (!("user" in session)) throw new Error("expected a session");
    kernel.authority.setAccess(session.user.id, { features: [] });
    const id = createUlid()();
    const sample: Record<string, unknown> = {
      "media.search": { query: "x" },
      "media.track.resolve": { source: "fake", providerId: "one" },
      "media.library.get": {},
      "media.track.play": { track: id },
      "media.track.prepare": { track: id },
      "media.favorite.set": { track: id, value: { v: true, ...stamp() } },
      "media.queue.set": { tracks: [], ...stamp() },
      "media.stopAtEnd.set": { value: true, ...stamp() },
      "media.playlist.create": { title: "x" },
      "media.playlist.delete": { playlist: id },
      "media.playlist.items": { playlist: id, tracks: [] },
      "media.retention.set": {
        kind: "playlist",
        id,
        value: { v: 1, ...stamp() },
      },
      "media.track.recordPlay": { track: id, ...stamp() },
      "media.playlist.recordPlay": { playlist: id, ...stamp() },
      "media.playlist.share": {
        playlist: id,
        principalType: "user",
        principal: id,
        level: "read",
      },
      "media.playlist.grants": { playlist: id },
      "media.playlist.principals": {},
    };
    expect(Object.keys(sample).sort()).toEqual(
      mediaMethods.map((m) => m.name).sort(),
    );
    for (const method of mediaMethods) {
      await expect(
        anonymous.call(method.name, sample[method.name]),
        method.name,
      ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
      await expect(
        ordinary.client.call(method.name, sample[method.name]),
        method.name,
      ).rejects.toMatchObject({ code: "E_DENIED" });
    }
  });
});
