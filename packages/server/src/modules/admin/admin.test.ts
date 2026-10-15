import { describe, it, expect } from "vitest";
import { createMemoryObjectStore } from "@talos/objectstore";
import { createApi } from "@talos/contract";
import { LinkClient, createMemoryCarrierPair } from "@talos/link";
import { deferred, createUlid } from "@talos/base";
import { Db } from "../../kernel/persistence/db.ts";
import { createKernel } from "../../app/create-application.ts";
import type { Kernel } from "../../app/create-application.ts";
async function connect(kernel: Kernel, device: string | null) {
  const ready = deferred<void>();
  const client = new LinkClient({
    connect: async () => {
      const pair = createMemoryCarrierPair();
      kernel.host.link.accept(pair.b, {});
      return pair.a;
    },
    hello: () => ({ v: 1, build: "test", device, lang: "zh-CN" }),
  });
  client.onWelcome(() => ready.resolve());
  client.start();
  await ready.promise;
  return { client, api: createApi(client.call.bind(client)) };
}
describe("admin workbench over memory link", () => {
  it("purges domain data through a durable job and keeps the last root", async () => {
    const db = new Db();
    const kernel = createKernel({
      db,
      store: createMemoryObjectStore(),
      build: "test",
      dev: true,
      testSeed: true,
    });
    const boot = await connect(kernel, null);
    const device = (await boot.api.auth.device.register({})).device;
    boot.client.stop();
    const admin = await connect(kernel, device);
    try {
      await admin.api.auth.login({ pin: "123456" });
      const root = (await admin.api.admin.user.list({ query: "root" }))
        .items[0]!;
      await expect(
        admin.api.admin.user.purge({ id: root.id }),
      ).rejects.toMatchObject({ code: "E_DENIED" });
      const user = await admin.api.admin.user.create({
        handle: "purgetest",
        pin: "122334",
      });
      db.run(
        "INSERT INTO me_settings(user_id,key,value,rev,deleted) VALUES(?,?,?,0,0)",
        user.user.id,
        "test",
        "true",
      );
      const uid = user.user.id;
      kernel.authority.setAccess(uid, { roles: ["root"] });
      kernel.community.initializeUser(uid);
      const id = createUlid();
      const conv = kernel.community.conversations(uid)[0]!.id;
      const post = kernel.chat.send(uid, {
        id: id(),
        conversation: conv,
        kind: "text",
        text: "purged author",
      }).post;
      const collection = kernel.library.createCollection(uid, "shared library");
      const otherCollection = kernel.library.createCollection(
        root.id,
        "surviving library",
      );
      const imported = await kernel.library.importText(uid, {
        title: "purged document",
        body: "text",
        collection,
      });
      for (
        let i = 0;
        i < 100 && kernel.jobs.get(imported.job)?.state !== "done";
        i++
      )
        await new Promise((resolve) => setTimeout(resolve, 1));
      expect(kernel.jobs.get(imported.job)?.state).toBe("done");
      kernel.library.setItems(otherCollection, [imported.doc]);
      const playlist = kernel.media.createPlaylist(uid, "shared playlist").id;
      for (const resource of [collection, playlist])
        kernel.authority.setGrant({
          resource: `coll:${resource}`,
          principalType: "user",
          principal: root.id,
          level: "read",
        });
      kernel.ai.create(uid, "private AI");
      kernel.ai.workspace.write(uid, "note.txt", "private", null);
      db.run("INSERT INTO learning_words VALUES(?,?,?)", id(), "hello", "你好");
      const word = db.get<{ id: string }>(
        "SELECT id FROM learning_words LIMIT 1",
      )!.id;
      db.run(
        "INSERT INTO learning_progress VALUES(?,?,?,0,0)",
        uid,
        word,
        "{}",
      );
      const active = kernel.jobs.enqueue(uid, "debug.sleep", { ms: 30000 });
      for (
        let i = 0;
        i < 50 && kernel.jobs.get(active.id)?.state !== "running";
        i++
      )
        await new Promise((resolve) => setTimeout(resolve, 1));
      const before = await admin.api.sync.pull({ cursors: {} });
      const cursors = Object.fromEntries(
        Object.entries(before.scopes).map(([scope, value]) => [
          scope,
          value.cursor,
        ]),
      );
      const { jobId } = await admin.api.admin.user.purge({ id: user.user.id });
      for (let i = 0; i < 100 && kernel.jobs.get(jobId)?.state !== "done"; i++)
        await new Promise((resolve) => setTimeout(resolve, 1));
      expect(kernel.jobs.get(jobId)?.state).toBe("done");
      expect(db.all("PRAGMA foreign_key_check")).toEqual([]);
      expect(
        db.all("SELECT * FROM object_refs WHERE owner_id=?", imported.doc),
      ).toEqual([]);
      for (const table of ["ai_rows", "ai_files"])
        expect(db.all(`SELECT * FROM ${table} WHERE user=?`, uid)).toEqual([]);
      expect(
        db.all("SELECT * FROM learning_progress WHERE user_id=?", uid),
      ).toEqual([]);
      const after = await admin.api.sync.pull({ cursors });
      expect(after.gone).toEqual(
        expect.arrayContaining([`coll:${collection}`, `coll:${playlist}`]),
      );
      expect(after.scopes[`conv:${conv}`]?.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "post", id: post.id, deleted: true }),
          expect.objectContaining({
            type: "communityMember",
            id: uid,
            deleted: true,
          }),
        ]),
      );
      expect(after.scopes[`coll:${otherCollection}`]?.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "libraryDoc",
            id: imported.doc,
            deleted: true,
          }),
        ]),
      );

      expect(
        db.get("SELECT id FROM users WHERE id=?", user.user.id),
      ).toBeUndefined();
      expect(
        db.get("SELECT user_id FROM me_settings WHERE user_id=?", user.user.id),
      ).toBeUndefined();
    } finally {
      admin.client.stop();
      await kernel.close();
      db.close();
    }
  });
  it("pages users, enforces role and last-root rules, and reports partial bulk results", async () => {
    const db = new Db();
    const kernel = createKernel({
      db,
      store: createMemoryObjectStore(),
      build: "test",
      dev: true,
      testSeed: true,
    });
    const root = await connect(kernel, null);
    const device = (await root.api.auth.device.register({})).device;
    root.client.stop();
    const admin = await connect(kernel, device);
    try {
      await admin.api.auth.login({ pin: "123456" });
      const created = await admin.api.admin.user.create({
        handle: "example",
        pin: "334455",
      });
      expect(created.user.handle).toBe("example");
      expect(
        (await admin.api.admin.user.list({ query: "ex" })).items.map(
          (u) => u.id,
        ),
      ).toContain(created.user.id);
      expect((await admin.api.admin.user.list({ query: "%" })).total).toBe(0);
      expect(
        (
          await admin.api.admin.user.list({
            offset: 1,
            limit: 1,
            sort: "handle",
          })
        ).items,
      ).toHaveLength(1);
      const user = await connect(kernel, null);
      const userDevice = (await user.api.auth.device.register({})).device;
      user.client.stop();
      const ordinary = await connect(kernel, userDevice);
      try {
        await ordinary.api.auth.login({ pin: "334455" });
        await expect(ordinary.api.admin.user.list({})).rejects.toMatchObject({
          code: "E_DENIED",
        });
        const roleUpdate = await admin.api.admin.user.update({
          id: created.user.id,
          roles: ["advanced_community_manager"],
          features: ["offline", "articles"],
          mutedUntil: Date.now() + 60_000,
        });
        expect(roleUpdate.user.roles).toEqual(
          expect.arrayContaining([
            "administrator",
            "community_manager",
            "advanced_community_manager",
          ]),
        );
        expect(roleUpdate.user.features).toEqual(["offline", "articles"]);
        expect(roleUpdate.user.mutedUntil).toBeGreaterThan(Date.now());
        expect(
          (await admin.api.admin.user.list({ query: "example" })).items[0]
            ?.mutedUntil,
        ).toBe(roleUpdate.user.mutedUntil);
        await expect(
          admin.api.admin.user.update({
            id: (await admin.api.admin.user.list({ query: "root" })).items[0]!
              .id,
            roles: [],
          }),
        ).rejects.toMatchObject({ code: "E_CONFLICT" });
        const result = await admin.api.admin.user.bulk({
          ids: [
            created.user.id,
            (await admin.api.admin.user.list({ query: "root" })).items[0]!.id,
          ],
          changes: { banned: true },
        });
        expect(result.results.map((r) => r.ok)).toEqual([true, false]);
        await admin.api.admin.user.update({
          id: created.user.id,
          banned: false,
        });
        const tri = await admin.api.admin.user.bulk({
          ids: [created.user.id, "01AAAAAAAAAAAAAAAAAAAAAAAA"],
          gateChanges: { offline: "disable", learning: "enable" },
          roleChanges: { community_manager: "enable" },
          changes: { mutedUntil: Number.MAX_SAFE_INTEGER },
        });
        expect(tri.results.map((r) => r.ok)).toEqual([true, false]);
        const changed = (await admin.api.admin.user.list({ query: "example" }))
          .items[0]!;
        expect(changed.features).toContain("learning");
        expect(changed.features).not.toContain("offline");
        expect(changed.roles).toContain("community_manager");
        expect(changed.mutedUntil).toBe(roleUpdate.user.mutedUntil);
        await admin.api.admin.user.bulk({
          ids: [created.user.id],
          changes: { mutedUntil: 0 },
        });
        expect(
          kernel.admin
            .listUsers({ query: created.user.handle })
            .items.find((user) => user.id === created.user.id)!.mutedUntil,
        ).toBe(0);
        await admin.api.admin.user.bulk({
          ids: [created.user.id],
          changes: { mutedUntil: Number.MAX_SAFE_INTEGER },
        });
        expect(
          kernel.admin
            .listUsers({ query: created.user.handle })
            .items.find((user) => user.id === created.user.id)!.mutedUntil,
        ).toBe(Number.MAX_SAFE_INTEGER);
        await expect(ordinary.api.admin.user.list({})).rejects.toMatchObject({
          code: "E_DENIED",
        });
        expect(
          (await admin.api.admin.audit.list({})).items.some(
            (row) => row.action === "admin.user.bulk",
          ),
        ).toBe(true);
      } finally {
        ordinary.client.stop();
      }
    } finally {
      admin.client.stop();
      await kernel.close();
      db.close();
    }
  });
  it("keeps the current device whitelisted and exposes incident self-test", async () => {
    const db = new Db();
    const kernel = createKernel({
      db,
      store: createMemoryObjectStore(),
      build: "test",
      dev: true,
      testSeed: true,
    });
    const boot = await connect(kernel, null);
    const device = (await boot.api.auth.device.register({})).device;
    boot.client.stop();
    const admin = await connect(kernel, device);
    try {
      await admin.api.auth.login({ pin: "123456" });
      expect(
        (await admin.api.admin.device.policy.set({ whitelist: true }))
          .whitelist,
      ).toBe(true);
      expect(
        (await admin.api.admin.device.list({})).items.find(
          (d) => d.id === device,
        )?.whitelisted,
      ).toBe(true);
      const invitation = await admin.api.identity.invitation.create({});
      expect(
        (await admin.api.admin.invitation.list({})).items.some(
          (i) => i.id === invitation.id,
        ),
      ).toBe(true);
      await admin.api.admin.invitation.revoke({ id: invitation.id });
      expect(
        (await admin.api.admin.invitation.list({})).items.some(
          (i) => i.id === invitation.id,
        ),
      ).toBe(false);
      const invites = await Promise.all([
        admin.api.identity.invitation.create({}),
        admin.api.identity.invitation.create({}),
      ]);
      const revoked = await admin.api.admin.invitation.bulkRevoke({
        ids: [invites[0]!.id, invites[1]!.id, invitation.id],
      });
      expect(revoked.results.map((row) => row.ok)).toEqual([true, true, false]);
      const deviceEdit = await admin.api.admin.device.update({
        id: device,
        label: "工作平板",
        persistent: true,
      });
      expect(deviceEdit.device.label).toBe("工作平板");
      expect(deviceEdit.device.persistent).toBe(true);
      expect(
        (
          await admin.api.admin.device.policy.set({
            identitySignals: ["clientId", "userAgent"],
          })
        ).identitySignals,
      ).toEqual(["clientId", "userAgent"]);
      kernel.identity.devices.bindDeviceSignals(
        device,
        "127.0.0.1",
        "Browser/1",
      );
      expect(() =>
        kernel.identity.devices.checkDeviceSignals(
          device,
          "127.0.0.1",
          "Browser/2",
        ),
      ).toThrow(/设备识别信息已变化/);
      expect(() =>
        kernel.identity.devices.checkDeviceSignals(
          device,
          "127.0.0.1",
          "Browser/1",
        ),
      ).not.toThrow();
      await expect(
        admin.api.admin.device.update({ id: device, whitelisted: false }),
      ).rejects.toMatchObject({ code: "E_DENIED" });
      expect(
        (
          await admin.api.admin.settings.set({
            maxVolume: 0.75,
            evictionDays: 60,
          })
        ).maxVolume,
      ).toBe(0.75);
      expect((await admin.api.media.library.get({})).maxVolume).toBe(0.75);
      await admin.api.admin.settings.set({ maxVolume: 0.5 });
      expect((await admin.api.media.library.get({})).maxVolume).toBe(0.5);
      await expect(admin.api.admin.incident.selfTest({})).rejects.toMatchObject(
        { code: "E_INTERNAL" },
      );
      const id = (await admin.api.admin.incident.list({ source: "server" }))
        .items[0]!.id;
      const detail = await admin.api.admin.incident.detail({ id });
      expect(detail.stack).toContain("AdminDiagnostics.selfTest");
      expect(
        (
          await admin.api.admin.incident.list({
            module: "admin",
            level: "error",
          })
        ).items.some((row) => row.id === id),
      ).toBe(true);
      const download = await admin.api.admin.incident.download({});
      const ticket = await kernel.tickets.resolve(download.ticket);
      expect(ticket.mime).toBe("application/zip");
      const chunks: Uint8Array[] = [];
      for await (const chunk of ticket.source!.read()) chunks.push(chunk);
      expect(new DataView(chunks[0]!.buffer).getUint32(0, true)).toBe(
        0x04034b50,
      );
      expect(
        (await admin.api.admin.incident.list({})).items.some(
          (i) => i.id === id,
        ),
      ).toBe(true);
      expect(
        (await admin.api.admin.group.list({})).total,
      ).toBeGreaterThanOrEqual(0);
    } finally {
      admin.client.stop();
      await kernel.close();
      db.close();
    }
  });
});

it("timed bans revoke immediately, skip active bulk bans, expire after restart and preserve the last active root", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "talos-bans-"));
  let now = 1_000_000;
  const options = {
    store: createMemoryObjectStore(),
    build: "test",
    dev: true,
    testSeed: true,
    clock: {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: unknown) =>
        clearTimeout(id as ReturnType<typeof setTimeout>),
    },
  };
  let db = new Db(join(directory, "test.sqlite"));
  let kernel = createKernel({ ...options, db });
  const boot = await connect(kernel, null);
  const device = (await boot.api.auth.device.register({})).device;
  boot.client.stop();
  let admin = await connect(kernel, device);
  const ordinary = await connect(kernel, null);
  try {
    await admin.api.auth.login({ pin: "123456" });
    await ordinary.api.auth.device.register({});
    const session = await ordinary.api.auth.login({ pin: "654321" });
    if ("onboarding" in session) throw Error("onboarding");
    const uid = session.user.id;
    kernel.authority.setAccess(uid, { roles: ["root"] });
    const revoked = deferred<unknown>();
    ordinary.client.on("identity.session.revoked", (event) =>
      revoked.resolve(event.data),
    );
    const until = now + 60_000;
    expect(
      (
        await admin.api.admin.user.update({
          id: uid,
          banned: true,
          bannedUntil: until,
        })
      ).user,
    ).toMatchObject({ banned: true, bannedUntil: until });
    expect(await revoked.promise).toMatchObject({
      reason: "banned",
      retryAt: until,
    });
    expect(
      db.get("SELECT 1 FROM sessions WHERE user_id=?", uid),
    ).toBeUndefined();
    await expect(
      ordinary.api.auth.login({ pin: "654321" }),
    ).rejects.toMatchObject({ data: { reason: "banned", retryAt: until } });
    expect(
      (
        await admin.api.admin.user.bulk({
          ids: [uid],
          changes: { banned: true, bannedUntil: now + 120_000 },
        })
      ).results,
    ).toEqual([{ id: uid, ok: true }]);
    expect(kernel.identity.repo.user(uid)?.banned_until).toBe(until);
    const root = (await admin.api.admin.user.list({ query: "root" })).items[0]!;
    await expect(
      admin.api.admin.user.update({ id: root.id, banned: true }),
    ).rejects.toMatchObject({ code: "E_CONFLICT" });
    ordinary.client.stop();
    admin.client.stop();
    await kernel.close();
    db.close();
    now = until;
    db = new Db(join(directory, "test.sqlite"));
    kernel = createKernel({ ...options, db });
    admin = await connect(kernel, device);
    await admin.api.auth.login({ pin: "123456" });
    expect(kernel.identity.repo.active(uid)).toBe(true);
    expect(kernel.authority.repo.roots()).toBe(2);
    expect(
      (await admin.api.admin.user.list({ query: session.user.handle }))
        .items[0],
    ).toMatchObject({ banned: false, bannedUntil: null });
    await admin.api.admin.user.update({ id: uid, banned: true });
    now += 1_000_000;
    expect(kernel.identity.repo.active(uid)).toBe(false);
    await admin.api.admin.user.update({ id: uid, banned: false });
    expect(kernel.identity.repo.active(uid)).toBe(true);
    await expect(
      admin.api.admin.user.update({
        id: uid,
        banned: true,
        bannedUntil: now - 1,
      }),
    ).rejects.toMatchObject({ code: "E_INVALID" });
    await Promise.all([
      expect(
        admin.api.admin.user.update({ id: uid, pin: "998877", banned: true }),
      ).rejects.toMatchObject({ code: "E_CONFLICT" }),
      admin.api.admin.user.update({ id: root.id, banned: true }),
    ]);
    expect(kernel.authority.repo.roots()).toBe(1);
  } finally {
    ordinary.client.stop();
    admin.client.stop();
    await kernel.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("attributes bounded client reports, denies anonymous/report readers, filters provenance, and rate limits", async () => {
  const db = new Db();
  const kernel = createKernel({
    db,
    store: createMemoryObjectStore(),
    build: "diagnostic-build",
    dev: true,
    testSeed: true,
    serverLogs: () => '{"build":"diagnostic-build","message":"server started"}',
  });
  const client = await connect(kernel, null);
  try {
    const report = {
      name: "Error",
      stack:
        " at client (https://host/app.js?token=SECRET:10:2)\n at pin=123456 token=TOPSECRET",
      kind: "error" as const,
      build: "client-build",
      environment: "Chrome/70 device/test",
    };
    await expect(
      client.api.admin.incident.report(report),
    ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
    await client.api.auth.device.register({});
    await client.api.auth.login({ pin: "654321" });
    await client.api.admin.incident.report(report);
    await expect(client.api.admin.incident.list({})).rejects.toMatchObject({
      code: "E_DENIED",
    });
    await expect(client.api.admin.incident.selfTest({})).rejects.toMatchObject({
      code: "E_DENIED",
    });
    const row = kernel.incidents.list().find((r) => r.source === "client")!;
    expect(row).toMatchObject({
      source: "client",
      build: "client-build",
      environment: report.environment,
    });
    expect(JSON.stringify(row)).not.toMatch(/TOPSECRET|123456|token=SECRET/);
    for (let i = 1; i < 30; i++) await client.api.admin.incident.report(report);
    await expect(
      client.api.admin.incident.report(report),
    ).rejects.toMatchObject({ code: "E_BUSY" });
    await client.api.auth.login({ pin: "123456" });
    expect(
      (
        await client.api.admin.incident.list({
          source: "client",
          build: "client-build",
          environment: report.environment,
        })
      ).items,
    ).toHaveLength(1);
    expect(
      (await client.api.admin.incident.list({ build: "other" })).items,
    ).toHaveLength(0);
    await expect(client.api.admin.incident.selfTest({})).rejects.toMatchObject({
      code: "E_INTERNAL",
    });
    expect(
      kernel.incidents.list().find((r) => r.source === "server"),
    ).toMatchObject({
      build: "diagnostic-build",
      environment: expect.stringContaining("node/"),
    });
    const download = await client.api.admin.incident.download({});
    const ticket = await kernel.tickets.resolve(download.ticket);
    const chunks = [];
    for await (const chunk of ticket.source!.read()) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toContain("server started");
  } finally {
    client.client.stop();
    await kernel.close();
    db.close();
  }
});
