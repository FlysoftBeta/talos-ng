// Backend API availability for the operations feature (task 150 (c)): real kernel behind
// the real link host. Root read paths answer; every `ops.*` method is refused to anonymous
// callers and to ordinary users, and the root/administrator split of OPS_ACTION_ROLES is
// enforced per method. Mutating root-only methods (apply, install, host.run ...) are only
// probed for refusal here; their behaviour is covered in ops.test.ts.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createUlid, deferred } from "@talos/base";
import { OPS_ACTION_ROLES, createApi, methods } from "@talos/contract";
import { createMemoryCarrierPair, LinkClient } from "@talos/link";
import { createFsObjectStore } from "@talos/objectstore";
import { createKernel } from "../../app/create-application.ts";
import type { Kernel } from "../../app/create-application.ts";
import { Db } from "../../kernel/persistence/db.ts";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function assemble() {
  const root = await mkdtemp(join(tmpdir(), "talos-ops-api-"));
  const db = new Db(join(root, "talos.db"));
  const kernel: Kernel = createKernel({
    db,
    store: createFsObjectStore({ root }),
    build: "A",
    dev: true,
    testSeed: true,
    ops: { dataDir: root },
  });
  cleanup.push(async () => {
    await kernel.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  });
  const open = async (pin: string | null) => {
    const ready = deferred<void>();
    const client = new LinkClient({
      connect: async () => {
        const pair = createMemoryCarrierPair();
        kernel.host.link.accept(pair.b, {});
        return pair.a;
      },
      hello: () => ({ v: 1, build: "A", device: null, lang: "zh-CN" }),
    });
    cleanup.push(() => client.stop());
    client.onWelcome(() => ready.resolve());
    client.start();
    await ready.promise;
    const api = createApi(client.call.bind(client));
    let user = "";
    if (pin) {
      await api.auth.device.register({});
      const session = await api.auth.login({ pin });
      if (!("user" in session)) throw new Error("expected a session");
      user = session.user.id;
    }
    return { client, api, user };
  };
  return { kernel, open };
}

const opsMethods = methods.filter((m) => m.name.startsWith("ops."));
const id = createUlid()();
const args: Record<string, unknown> = {
  "ops.settings.get": {},
  "ops.settings.set": {
    retention: 3,
    daily: false,
    cloudEnabled: false,
    autoCheck: false,
    manifestUrl: "",
  },
  "ops.backup.list": {},
  "ops.backup.create": {},
  "ops.backup.delete": { id },
  "ops.backup.download": { id },
  "ops.update.status": {},
  "ops.update.stage": { upload: id },
  "ops.update.apply": {},
  "ops.update.confirm": {},
  "ops.update.check": {},
  "ops.update.install": {},
  "ops.https.status": {},
  "ops.host.status": {},
  "ops.host.run": { action: "kill-wps" },
  "ops.office.list": {},
  "ops.office.refresh": {},
  "ops.office.clear": {},
  "ops.office.download": { id },
};

describe("ops API availability", () => {
  it("has sample arguments and a role for every ops method", () => {
    const names = opsMethods.map((m) => m.name).sort();
    expect(Object.keys(args).sort()).toEqual(names);
    expect(
      Object.keys(OPS_ACTION_ROLES)
        .filter((n) => n !== "ops.enter")
        .sort(),
    ).toEqual(names);
  });

  it("answers the root read paths", async () => {
    const { open } = await assemble();
    const { api } = await open("123456");
    expect((await api.ops.settings.get({})).retention).toBeGreaterThan(0);
    expect(await api.ops.backup.list({})).toEqual([]);
    expect((await api.ops.update.status({})).build).toBe("A");
    expect(Array.isArray((await api.ops.https.status({})).listeners)).toBe(
      true,
    );
    expect(typeof (await api.ops.host.status({})).available).toBe("boolean");
    expect(Array.isArray((await api.ops.office.list({})).files)).toBe(true);
  });

  it("refuses every ops method to anonymous callers and ordinary users", async () => {
    const { open } = await assemble();
    const anonymous = await open(null);
    const ordinary = await open("654321");
    for (const method of opsMethods) {
      await expect(
        anonymous.client.call(method.name, args[method.name]),
        method.name,
      ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
      await expect(
        ordinary.client.call(method.name, args[method.name]),
        method.name,
      ).rejects.toMatchObject({ code: "E_DENIED" });
    }
  });

  it("lets an administrator use administrator actions only", async () => {
    const { kernel, open } = await assemble();
    const manager = await open("654321");
    kernel.authority.setAccess(manager.user, { roles: ["administrator"] });
    for (const method of opsMethods) {
      const role =
        OPS_ACTION_ROLES[method.name as keyof typeof OPS_ACTION_ROLES];
      const outcome = manager.client.call(method.name, args[method.name]);
      if (role === "root")
        await expect(outcome, method.name).rejects.toMatchObject({
          code: "E_DENIED",
        });
      else
        await outcome.then(
          () => undefined,
          (error: { code?: string }) =>
            expect(error.code, method.name).not.toMatch(
              /E_DENIED|E_UNAUTHENTICATED/,
            ),
        );
    }
  });
});
