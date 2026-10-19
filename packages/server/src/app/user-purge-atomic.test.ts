import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createUlid, deferred } from "@talos/base";
import { createMemoryObjectStore } from "@talos/objectstore";
import { Db } from "../kernel/persistence/db.ts";
import { IdentityPurgeRepo } from "../modules/identity/purge-repo.ts";
import { identityPurge } from "../modules/identity/purge.ts";
import { createApi } from "@talos/contract";
import { LinkClient, createMemoryCarrierPair } from "@talos/link";
import { createKernel } from "./create-application.ts";
import type { Kernel, KernelOptions } from "./create-application.ts";
import { composeUserPurge } from "./compose-user-purge.ts";
import { UserPurgeRegistry } from "./user-purge.ts";

const kernels: Kernel[] = [];
function kernel(db = new Db(), options: Partial<KernelOptions> = {}) {
  const k = createKernel({
    db,
    store: createMemoryObjectStore(),
    build: "purge-test",
    dev: true,
    testSeed: true,
    backgroundTasks: false,
    printRootPin: () => {},
    ...options,
  });
  kernels.push(k);
  return k;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const k of kernels.splice(0)) {
    await k.close();
    k.db.close();
  }
});
function user(k: Kernel) {
  return k.identity.repo
    .activeUserIds()
    .find((id) => k.identity.repo.user(id)!.handle === "demo")!;
}
function root(k: Kernel) {
  return k.identity.repo
    .activeUserIds()
    .find((id) => k.identity.repo.user(id)!.handle === "root")!;
}
function snapshot(db: Db) {
  return Object.fromEntries(
    db
      .all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .map(({ name }) => [
        name,
        db.all(`SELECT * FROM "${name}" ORDER BY rowid`),
      ]),
  );
}
async function populate(k: Kernel, uid: string) {
  const id = createUlid();
  const conversation = k.community.conversations(uid)[0]!.id;
  k.chat.send(uid, { id: id(), conversation, kind: "text", text: "private" });
  k.ai.create(uid, "private AI");
  k.ai.workspace.write(uid, "note.txt", "private", null);
  k.db.run("INSERT INTO me_settings VALUES(?,'private','true',0,0)", uid);
  const collection = k.library.createCollection(uid, "owned");
  const doc = await k.library.importText(uid, {
    title: "private doc",
    body: "private body",
    collection,
  });
  const surviving = k.library.createCollection(root(k), "surviving");
  k.library.setItems(surviving, [doc.doc]);
  const playlist = k.media.createPlaylist(uid, "owned").id;
  for (const resource of [collection, playlist])
    k.authority.setGrant({
      resource: `coll:${resource}`,
      principalType: "user",
      principal: root(k),
      level: "read",
    });
  k.authority.setGrant({
    resource: `coll:${surviving}`,
    principalType: "user",
    principal: uid,
    level: "read",
  });
  k.db.run("INSERT INTO library_states VALUES(?,'state','{}',0,0)", uid);
  k.db.run(
    "INSERT INTO library_delegations VALUES(?,'user',?,1)",
    collection,
    uid,
  );
  k.db.run(
    "INSERT INTO media_user_states VALUES(?, ?,0,0)",
    uid,
    JSON.stringify(k.media.state(uid)),
  );
  k.db.run("INSERT INTO chat_texts VALUES('staging',?,1,'text',0)", uid);
  k.db.run("INSERT INTO chat_ack VALUES(?,0,0,0)", uid);
  k.db.run("INSERT INTO chat_mutes VALUES(?,0,0,0)", uid);
  k.db.run("INSERT INTO ai_accounts VALUES(?,1,0)", uid);
  k.db.run(
    "INSERT INTO ai_ledger VALUES('ledger',?,'topup',1,'test',0,'test')",
    uid,
  );
  k.db.run("INSERT INTO ai_texts VALUES('text',?,1,'x',0)", uid);
  k.db.run(
    "INSERT INTO ai_runs VALUES('run',?,'conversation','message','job','done',0,0,0,0,'day','week',0)",
    uid,
  );
  k.db.run("INSERT INTO ai_tools VALUES('run','tool','{}')");
  k.db.run(
    "INSERT INTO devices(id,label,last_seen,bound_user) VALUES('device','test',0,?)",
    uid,
  );
  k.db.run(
    "INSERT INTO sessions VALUES('session',?,'device',0,9999999999999)",
    uid,
  );
  k.db.run(
    "INSERT INTO invitations(id,created,expires,claimed_by) VALUES('invitation',0,0,?)",
    uid,
  );
  const upload = await k.uploads.begin(uid, { kind: "image", size: 0 });
  await k.uploads.commit(uid, { id: upload.id });
  k.db.run(
    "INSERT INTO netbooks_downloads VALUES('download',?,'book',?,NULL,NULL)",
    uid,
    collection,
  );
  k.db.run("INSERT INTO netbooks_chapters VALUES('download',0,'chapter')");
}
const owners = [
  "community",
  "chat",
  "ai",
  "netbooks",
  "library",
  "media",
  "me",
  "authority",
  "uploads",
  "jobs",
  "identity",
];
it.each(owners)(
  "rolls back every domain row, revision, nested changes and effects after %s",
  async (boundary) => {
    const k = kernel(),
      uid = user(k);
    await populate(k, uid);
    let effects = 0;
    const register = UserPurgeRegistry.prototype.register;
    vi.spyOn(UserPurgeRegistry.prototype, "register").mockImplementation(
      function (this: UserPurgeRegistry, p) {
        register.call(this, {
          owner: p.owner,
          purgeUser: (user, tx) => {
            expect(k.identity.repo.user(user)).toBeDefined();
            p.purgeUser(user, tx);
            k.uow.write((nested) => {
              nested.changed("test", "test", "test");
              nested.afterCommit(() => {
                effects++;
              });
            });
            expect(effects).toBe(0);
            if (p.owner === boundary) throw new Error("injected boundary");
          },
        });
      },
    );
    if (boundary === "identity") {
      const remove = IdentityPurgeRepo.prototype.remove;
      vi.spyOn(IdentityPurgeRepo.prototype, "remove").mockImplementation(
        function (this: IdentityPurgeRepo, user) {
          // FK enforcement also proves all dependent owners ran before identity.
          remove.call(this, user);
          expect(k.identity.repo.user(user)).toBeUndefined();
          throw new Error("injected boundary");
        },
      );
    }
    let before: ReturnType<typeof snapshot> | undefined;
    const committed = vi.spyOn(k.syncHub, "committed");
    const purge = composeUserPurge(k, async () => {
      before = snapshot(k.db);
      committed.mockClear();
    });
    await expect(purge.run(uid)).rejects.toThrow("injected boundary");
    expect(snapshot(k.db)).toEqual(before);
    expect(committed).not.toHaveBeenCalled();
    expect(effects).toBe(0);
    expect(k.identity.repo.user(uid)?.purging).toBe(1);
    expect(k.identity.directory.user(uid)?.deactivated).toBe(true);
    expect(k.db.all("PRAGMA foreign_key_check")).toEqual([]);
  },
);
it("rejects duplicate owners, identity registration, and thenables without leaking writes", async () => {
  const k = kernel(),
    uid = user(k);
  const purge = new UserPurgeRegistry({
    uow: k.uow,
    identity: identityPurge(k.db, k.identity.repo, () => {}),
    quiesce: async () => {},
  });
  purge.register({
    owner: "test",
    purgeUser: (_u, tx) => {
      k.db.run("INSERT INTO me_settings VALUES(?,'x','true',?,0)", uid, tx.rev);
      return Promise.resolve();
    },
  });
  expect(() =>
    purge.register({ owner: "test", purgeUser: () => {} }),
  ).toThrow();
  expect(() =>
    purge.register({ owner: "identity", purgeUser: () => {} }),
  ).toThrow();
  await expect(purge.run(uid)).rejects.toMatchObject({ code: "E_CONFLICT" });
  expect(k.db.all("SELECT * FROM me_settings WHERE user_id=?", uid)).toEqual(
    [],
  );
});
it("rechecks effective last-root protection after quiescence", async () => {
  const k = kernel(),
    uid = user(k),
    administrator = root(k);
  k.authority.setAccess(uid, { roles: ["root"] });
  const purge = composeUserPurge(k, async () => {
    // Simulate an intervening policy change on the same real connection.
    k.db.run("UPDATE users SET deleted=1 WHERE id=?", administrator);
  });
  await expect(purge.run(uid)).rejects.toMatchObject({ code: "E_CONFLICT" });
  expect(k.identity.repo.user(uid)?.purging).toBe(1);
  expect(
    k.authority.repo.project(
      k.identity.repo.publicUser(k.identity.repo.user(uid)!),
    ).roles,
  ).toContain("root");
});
it("rolls back failed preparation, retries a persisted gate, and treats a committed restart as done", async () => {
  const dir = await mkdtemp(join(tmpdir(), "talos-purge-"));
  const file = join(dir, "db.sqlite");
  try {
    let k = kernel(new Db(file));
    const uid = user(k);
    await populate(k, uid);
    const original = IdentityPurgeRepo.prototype.prepare;
    const fail = vi
      .spyOn(IdentityPurgeRepo.prototype, "prepare")
      .mockImplementation(function (this: IdentityPurgeRepo, user, rev) {
        original.call(this, user, rev);
        throw new Error("preparation failed");
      });
    const before = snapshot(k.db);
    await expect(k.purge.run(uid)).rejects.toThrow("preparation failed");
    expect(snapshot(k.db)).toEqual(before);
    fail.mockRestore();
    const purge = composeUserPurge(k, async () => {
      throw new Error("quiescence failed");
    });
    await expect(purge.run(uid)).rejects.toThrow("quiescence failed");
    expect(k.identity.repo.user(uid)?.purging).toBe(1);
    await k.close();
    k.db.close();
    kernels.pop();
    k = kernel(new Db(file));
    expect(k.identity.repo.user(uid)?.purging).toBe(1);
    expect(() => k.jobs.enqueue(uid, "debug.sleep", {})).toThrow();
    const purgeJob = k.jobs.enqueue(root(k), "admin.user.purge", { user: uid });
    k.db.run("UPDATE jobs SET state='running' WHERE id=?", purgeJob.id);
    await k.purge.run(uid);
    expect(k.identity.repo.user(uid)).toBeUndefined();
    expect(k.db.all("SELECT * FROM netbooks_chapters")).toEqual([]);
    await k.close();
    k.db.close();
    kernels.pop();
    k = kernel(new Db(file));
    const revision = k.uow.revision;
    await expect(k.purge.run(uid)).resolves.toEqual({ user: uid });
    expect(k.uow.revision).toBe(revision);
    k.jobs.start();
    await expect.poll(() => k.jobs.get(purgeJob.id)?.state).toBe("done");
    expect(k.jobs.get(purgeJob.id)?.result).toEqual({ user: uid });
    expect(k.identity.repo.user(uid)).toBeUndefined();
    expect(k.db.all("PRAGMA foreign_key_check")).toEqual([]);
    await k.close();
    k.db.close();
    kernels.pop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("awaits late owner-job cleanup, including cleared cancelled jobs, and blocks new admission", async () => {
  const k = kernel(),
    uid = user(k);
  const entered = deferred<void>(),
    released = deferred<void>(),
    settled = deferred<void>();
  k.jobs.register("race", {
    concurrency: 1,
    timeoutMs: 10000,
    onBoot: "fail",
    run: async (ctx) => {
      entered.resolve();
      await new Promise<void>((resolve) =>
        ctx.signal.addEventListener("abort", () => resolve()),
      );
      await released.promise;
      k.uow.write(() =>
        k.db.run("INSERT INTO me_settings VALUES(?,'late','true',0,0)", uid),
      );
      settled.resolve();
    },
  });
  const job = k.jobs.enqueue(uid, "race", {});
  k.jobs.start();
  await entered.promise;
  k.jobs.cancel(uid, job.id);
  k.jobs.clear(uid, job.id);
  let finished = false;
  const purge = k.purge.run(uid).then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  expect(k.identity.repo.active(uid)).toBe(false);
  expect(() => k.jobs.enqueue(uid, "race", {})).toThrow();
  await expect(
    k.uploads.begin(uid, { kind: "image", size: 0 }),
  ).rejects.toMatchObject({ code: "E_DENIED" });
  released.resolve();
  await settled.promise;
  await purge;
  expect(k.db.all("SELECT * FROM me_settings WHERE user_id=?", uid)).toEqual(
    [],
  );
  expect(k.jobs.get(job.id)).toBeUndefined();
});
it("measures one final transaction for a large synthetic user", async () => {
  const k = kernel(),
    uid = user(k);
  k.db.tx(() => {
    for (let i = 0; i < 50000; i++)
      k.db.run(
        "INSERT INTO me_settings VALUES(?,?, 'true',0,0)",
        uid,
        `setting-${i}`,
      );
  });
  let started = 0;
  const purge = composeUserPurge(k, async () => {
    started = performance.now();
  });
  await purge.run(uid);
  const elapsed = performance.now() - started;
  process.stdout.write(
    `Atomic purge: 50,000 settings plus seeded membership/state: ${elapsed.toFixed(2)} ms after quiescence\n`,
  );
  expect(k.db.all("SELECT * FROM me_settings WHERE user_id=?", uid)).toEqual(
    [],
  );
});
it("cancels and awaits a provider request already admitted over Link before deleting identity", async () => {
  const entered = deferred<void>(),
    aborted = deferred<void>(),
    released = deferred<void>();
  const k = kernel(new Db(), {
    mediaProvider: {
      collection: async () => ({
        tracks: [],
        collections: [],
        next: null,
        collection: null,
      }),
      search: async (_input, signal) => {
        signal!.addEventListener("abort", () => aborted.resolve());
        entered.resolve();
        await released.promise;
        return {
          collections: [],
          next: null,
          collection: null,
          tracks: [
            {
              source: "test",
              providerId: "late",
              title: "late",
              artists: [],
              album: null,
              durationMs: 1,
              url: "test",
            },
          ],
        };
      },
      resolve: async () => {
        throw new Error("unused");
      },
      materialise: async () => {
        throw new Error("unused");
      },
    },
  });
  const uid = user(k);
  const ready = deferred<void>();
  const client = new LinkClient({
    connect: async () => {
      const pair = createMemoryCarrierPair();
      k.host.link.accept(pair.b, {});
      return pair.a;
    },
    hello: () => ({ v: 1, build: "test", device: null, lang: "zh-CN" }),
  });
  client.onWelcome(() => ready.resolve());
  client.start();
  await ready.promise;
  const api = createApi(client.call.bind(client));
  try {
    await api.auth.device.register({});
    const session = await api.auth.login({ pin: "654321" });
    expect(session).toHaveProperty("user.id", uid);
    const request = api.media.search({ query: "late" });
    const rejected = expect(request).rejects.toMatchObject({
      code: "E_DENIED",
    });
    await entered.promise;
    let finished = false;
    const purge = k.purge.run(uid).then(() => {
      finished = true;
    });
    await aborted.promise;
    expect(finished).toBe(false);
    expect(k.db.all("SELECT * FROM sessions WHERE user_id=?", uid)).toEqual([]);
    released.resolve();
    await rejected;
    await purge;
    expect(
      k.db.all("SELECT * FROM media_discoveries WHERE user_id=?", uid),
    ).toEqual([]);
    expect(
      k.db.all("SELECT * FROM media_tracks WHERE provider_id='late'"),
    ).toEqual([]);
    await expect(api.auth.login({ pin: "654321" })).rejects.toMatchObject({
      code: "E_UNAUTHENTICATED",
    });
  } finally {
    released.resolve();
    client.stop();
  }
});
it("drains an in-flight upload commit and rejects retention after the durable gate", async () => {
  const k = kernel(),
    uid = user(k);
  const entered = deferred<void>(),
    released = deferred<void>();
  const upload = await k.uploads.begin(uid, { kind: "file", size: 0 });
  const stage = k.store.stage.bind(k.store);
  vi.spyOn(k.store, "stage").mockImplementation(async (id) => {
    const value = await stage(id);
    return {
      ...value,
      commit: async (...args) => {
        entered.resolve();
        await released.promise;
        return value.commit(...args);
      },
    };
  });
  const commit = k.uploads.commit(uid, { id: upload.id });
  const rejected = expect(commit).rejects.toMatchObject({ code: "E_DENIED" });
  await entered.promise;
  let finished = false;
  const purge = k.purge.run(uid).then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  released.resolve();
  await rejected;
  await purge;
  expect(k.db.all("SELECT * FROM uploads WHERE owner=?", uid)).toEqual([]);
  expect(
    k.db.all("SELECT * FROM object_refs WHERE owner_id=?", upload.id),
  ).toEqual([]);
});
it("revokes outgoing group grants in every surviving member scope at the final revision", async () => {
  const k = kernel(),
    uid = user(k),
    administrator = root(k);
  const other = k.identity.createUser({ pin: "112233", name: "Other" }).id;
  k.community.initializeUser(other);
  const group = k.community.conversations(uid)[0]!.id;
  k.db.run("UPDATE community_conversations SET owner=? WHERE id=?", uid, group);
  const collection = k.library.createCollection(uid, "group shared");
  k.authority.setGrant({
    resource: `coll:${collection}`,
    principalType: "group",
    principal: group,
    level: "read",
  });
  const grant = k.authority.repo.grants(`coll:${collection}`)[0]!;
  for (const member of [administrator, other])
    expect(k.authority.repo.projection(member, grant.id)?.deleted).toBe(0);
  const commits = vi.spyOn(k.syncHub, "committed");
  await k.purge.run(uid);
  const final = commits.mock.calls.at(-1)![0];
  for (const member of [administrator, other]) {
    expect(k.authority.repo.projection(member, grant.id)).toEqual({
      deleted: 1,
      rev: final.rev,
    });
    expect(final.changes).toContainEqual({
      scope: `me:${member}`,
      type: "grant",
      id: grant.id,
    });
  }
  expect(final.changes).toContainEqual({
    scope: `conv:${group}`,
    type: "communityMember",
    id: uid,
  });
  expect(final.changes).toContainEqual({
    scope: `conv:${group}`,
    type: "communityConversation",
    id: group,
  });
  expect(
    k.db.get<{ owner: string | null }>(
      "SELECT owner FROM community_conversations WHERE id=?",
      group,
    )?.owner,
  ).toBeNull();
  expect(k.db.all("PRAGMA foreign_key_check")).toEqual([]);
});
it("checks the last effective root before committing any preparation", async () => {
  const k = kernel(),
    uid = user(k);
  k.authority.setAccess(uid, { roles: ["root"] });
  k.authority.setAccess(root(k), { roles: [] });
  const before = snapshot(k.db);
  await expect(k.purge.run(uid)).rejects.toMatchObject({ code: "E_CONFLICT" });
  expect(snapshot(k.db)).toEqual(before);
});
