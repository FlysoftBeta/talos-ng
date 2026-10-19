import { deferred } from "@talos/base";
import { createApi } from "@talos/contract";
import { digest, hostTarget, writeZip } from "@talos/launcher";
import { LinkClient, createMemoryCarrierPair } from "@talos/link";
import { createFsObjectStore } from "@talos/objectstore";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createKernel } from "../../app/create-application.ts";
import { Db } from "../../kernel/persistence/db.ts";
import { restoreBackup } from "./backup/service.ts";
import { CLASSROOM_PROCESSES, createHostTools } from "./host/adapter.ts";
import { createOfficeCapture, parseOpenDocuments } from "./office/adapter.ts";
import type { OpsOptions } from "./service.ts";
import { Updates } from "./updates/service.ts";
async function fixture(options: OpsOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "talos-ops-")),
    db = new Db(join(root, "talos.db"));
  const store = createFsObjectStore({ root });
  let pin = "";
  const kernel = createKernel({
    db,
    store,
    build: "A",
    ops: { dataDir: root, ...options },
    printRootPin: (p) => {
      pin = p;
    },
  });
  const ready = deferred<void>();
  const client = new LinkClient({
    connect: async () => {
      const pair = createMemoryCarrierPair();
      kernel.host.link.accept(pair.b, {});
      return pair.a;
    },
    hello: () => ({ v: 1, build: "A", device: null, lang: "zh-CN" }),
  });
  client.onWelcome(() => ready.resolve());
  client.start();
  await ready.promise;
  const api = createApi(client.call.bind(client));
  await api.auth.device.register({ label: "ops test" });
  const session = await api.auth.login({ pin });
  if (!("user" in session)) throw new Error("Expected root session");
  return {
    root,
    db,
    kernel,
    store,
    api,
    client,
    session,
    async close() {
      client.stop();
      await kernel.close();
      db.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
function update(build = "B"): Uint8Array {
  const files = new Map(
    ["server.js", "client/index.html", "shell/sw.js", "package.json"].map(
      (n) => [n, Buffer.from(n)],
    ),
  );
  files.set(
    "release.json",
    Buffer.from(
      JSON.stringify({
        v: 1,
        build,
        platform: hostTarget(),
        files: [...files].map(([path, b]) => ({
          path,
          size: b.length,
          sha256: digest(b),
        })),
      }),
    ),
  );
  return writeZip(files);
}
describe("ops over the memory link", () => {
  it("backs up, mutates, restores SQLite and exact object bytes", async () => {
    const f = await fixture();
    try {
      const bytes = Buffer.from("完整文档对象"),
        info = await f.kernel.objects.publish(
          () => f.store.put(bytes),
          (info) => f.kernel.objects.addRef(info.id, "test", "document"),
        );
      const backup = await f.api.ops.backup.create({});
      const path = f.kernel.ops.backups.path(backup.id);
      f.db.run("UPDATE users SET name='changed' WHERE id=?", f.session.user.id);
      await f.store.delete(info.id);
      f.client.stop();
      await f.kernel.close();
      f.db.close();
      await restoreBackup(path, f.root);
      const restored = new Db(join(f.root, "talos.db"));
      try {
        expect(
          restored.get<{ name: string }>(
            "SELECT name FROM users WHERE id=?",
            f.session.user.id,
          )?.name,
        ).not.toBe("changed");
        expect(
          restored.get("SELECT * FROM object_refs WHERE object_id=?", info.id),
        ).toBeDefined();
      } finally {
        restored.close();
      }
      expect(Buffer.from(await f.store.readAll(info.id))).toEqual(bytes);
    } finally {
      await f.close();
    }
  });
  it("retains configured count and validates traversal, corruption and missing objects", async () => {
    const f = await fixture();
    try {
      await f.api.ops.settings.set({
        ...(await f.api.ops.settings.get({})),
        retention: 1,
      });
      const first = await f.api.ops.backup.create({});
      const second = await f.api.ops.backup.create({});
      expect(await f.api.ops.backup.list({})).toEqual([second]);
      expect(() => f.kernel.ops.backups.path(first.id)).toThrow();
      expect(() => f.kernel.ops.backups.path("../x")).toThrow();
      const info = await f.kernel.objects.publish(
        () => f.store.put(Buffer.from("lost")),
        (info) => f.kernel.objects.addRef(info.id, "test", "x"),
      );
      await f.store.delete(info.id);
      await expect(f.api.ops.backup.create({})).rejects.toMatchObject({
        code: "E_NOT_FOUND",
      });
    } finally {
      await f.close();
    }
  });
  it("issues downloads, captures through the ledger, deduplicates and clears refs", async () => {
    const capture = vi.fn(async () => [
      {
        name: "课程.docx",
        application: "WPS",
        kind: "word" as const,
        bytes: Buffer.from("office"),
      },
    ]);
    const f = await fixture({ officeCapture: { available: true, capture } });
    try {
      const result = await f.api.ops.office.refresh({});
      expect(result.files).toHaveLength(1);
      await f.api.ops.office.refresh({});
      expect((await f.api.ops.office.list({})).files).toHaveLength(1);
      const ticket = await f.api.ops.office.download({
        id: result.files[0]!.id,
      });
      expect((await f.kernel.tickets.resolve(ticket.ticket)).filename).toBe(
        "课程.docx",
      );
      await f.api.ops.office.clear({});
      expect(
        f.db.all("SELECT * FROM object_refs WHERE owner_kind='ops-office'"),
      ).toHaveLength(0);
      await expect(
        f.kernel.tickets.resolve(ticket.ticket),
      ).rejects.toMatchObject({ code: "E_DENIED" });
      const backup = await f.api.ops.backup.create({});
      const download = await f.api.ops.backup.download({ id: backup.id });
      expect((await f.kernel.tickets.resolve(download.ticket)).mime).toBe(
        "application/octet-stream",
      );
    } finally {
      await f.close();
    }
  });
  it("enforces root-only host calls, audits attempts, reports Linux unavailable", async () => {
    const f = await fixture({ hostTools: createHostTools("linux") });
    try {
      await expect(
        f.api.ops.host.run({ action: "shutdown", delayMinutes: 0 }),
      ).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
      expect(f.kernel.audit.list().some((a) => a.target === "shutdown:0")).toBe(
        true,
      );
      f.db.run(
        "UPDATE users SET roles='[\"administrator\"]' WHERE id=?",
        f.session.user.id,
      );
      await expect(
        f.api.ops.host.run({ action: "reset-classroom" }),
      ).rejects.toMatchObject({ code: "E_DENIED" });
      expect(await f.api.ops.backup.list({})).toEqual([]);
      f.db.run("UPDATE users SET roles='[]' WHERE id=?", f.session.user.id);
      await expect(f.api.ops.backup.list({})).rejects.toMatchObject({
        code: "E_DENIED",
      });
    } finally {
      await f.close();
    }
  });
  it("reauthorizes RPCs and issued download tickets after M9 access changes", async () => {
    const f = await fixture({
      officeCapture: {
        available: true,
        capture: async () => [
          {
            name: "课程.docx",
            application: "WPS",
            kind: "word",
            bytes: Buffer.from("office"),
          },
        ],
      },
    });
    try {
      f.kernel.identity.createUser({
        pin: "918273",
        name: "备用管理员",
        roles: ["root"],
      });
      const backup = await f.api.ops.backup.create({});
      const backupTicket = await f.api.ops.backup.download({ id: backup.id });
      const office = await f.api.ops.office.refresh({});
      const officeTicket = await f.api.ops.office.download({
        id: office.files[0]!.id,
      });
      const actor = f.session.user.id;
      f.kernel.authority.setAccess(actor, { roles: ["administrator"] });
      expect(await f.api.ops.backup.list({})).toHaveLength(1);
      await expect(
        f.api.ops.host.run({ action: "shutdown", delayMinutes: 0 }),
      ).rejects.toMatchObject({ code: "E_DENIED" });
      await expect(
        f.kernel.tickets.resolve(backupTicket.ticket),
      ).resolves.toBeDefined();
      await expect(
        f.kernel.tickets.resolve(officeTicket.ticket),
      ).resolves.toBeDefined();
      f.kernel.authority.setAccess(actor, { roles: [] });
      await expect(f.api.ops.backup.list({})).rejects.toMatchObject({
        code: "E_DENIED",
      });
      await expect(
        f.kernel.tickets.resolve(backupTicket.ticket),
      ).rejects.toMatchObject({ code: "E_DENIED" });
      await expect(
        f.kernel.tickets.resolve(officeTicket.ticket),
      ).rejects.toMatchObject({ code: "E_DENIED" });
    } finally {
      await f.close();
    }
  });
  it("uploads via upload.*, validates, stages, replies before applying, confirms", async () => {
    const apply = vi.fn(),
      confirm = vi.fn();
    const f = await fixture({ bridge: { apply, confirm, pending: false } });
    try {
      const bytes = update(),
        upload = await f.api.upload.begin({ kind: "file", size: bytes.length });
      await f.api.upload.append({ id: upload.id, offset: 0 }, { body: bytes });
      await f.api.upload.commit({ id: upload.id });
      expect((await f.api.ops.update.stage({ upload: upload.id })).phase).toBe(
        "staged",
      );
      expect(apply).not.toHaveBeenCalled();
      await f.api.ops.update.apply({});
      await new Promise((r) => setImmediate(r));
      expect(apply).toHaveBeenCalledOnce();
      await f.api.ops.update.confirm({});
      expect(confirm).toHaveBeenCalledOnce();
    } finally {
      await f.close();
    }
  });
  it("cloud install does not reject its own staging guard", async () => {
    const f = await fixture();
    try {
      f.kernel.ops.repo.saveSettings({
        ...f.kernel.ops.repo.settings(),
        cloudEnabled: true,
        manifestUrl: "https://example.org/manifest.json",
      });
      const bytes = update();
      const fetch = vi.fn(async (url: string) =>
        url.endsWith("manifest.json")
          ? Buffer.from(
              JSON.stringify({
                v: 1,
                build: "B",
                url: "B.zip",
                size: bytes.length,
                sha256: digest(bytes),
              }),
            )
          : bytes,
      );
      const updates = new Updates(
        f.kernel.ops.repo,
        f.kernel.ops.backups,
        join(f.root, "updates"),
        "A",
        Date.now,
        { apply: () => {}, confirm: () => {}, pending: false },
        fetch,
      );
      expect((await updates.install()).phase).toBe("staged");
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      await f.close();
    }
  });
  it("corrupt restore never replaces the live database", async () => {
    const f = await fixture();
    try {
      const backup = await f.api.ops.backup.create({});
      const path = f.kernel.ops.backups.path(backup.id);
      await writeFile(join(path, "talos.db"), "corrupt");
      await expect(restoreBackup(path, f.root)).rejects.toMatchObject({
        code: "E_INTEGRITY",
      });
      expect(f.db.get("SELECT * FROM users")).toBeDefined();
    } finally {
      await f.close();
    }
  });
});
it("Windows host adapter uses fixed argv with no shell and tracks its own shutdown schedule", async () => {
  let now = 1_000_000;
  const run = vi.fn(async (file: string, args: readonly string[]) => {
    // Aborting with nothing scheduled fails on Windows.
    if (
      file === "shutdown.exe" &&
      args[0] === "/a" &&
      run.mock.calls.length < 3
    )
      throw new Error("no shutdown in progress");
    return "";
  });
  const tools = createHostTools("win32", run, () => now);
  await tools.run({ action: "reset-classroom" });
  expect(run.mock.calls[0]![0]).toBe("powershell.exe");
  const script = Buffer.from(run.mock.calls[0]![1].at(-1)!, "base64").toString(
    "utf16le",
  );
  expect(script).toContain("Shell.Application");
  for (const name of CLASSROOM_PROCESSES) expect(script).toContain(`'${name}'`);
  // An immediate shutdown keeps a grace; a failed abort does not block it.
  await tools.run({ action: "shutdown", delayMinutes: 0 });
  expect(run.mock.calls.slice(1, 3)).toEqual([
    ["shutdown.exe", ["/a"]],
    ["shutdown.exe", ["/s", "/t", "10"]],
  ]);
  expect(tools.shutdownAt()).toBe(now + 10_000);
  await tools.run({ action: "shutdown", delayMinutes: 45 });
  expect(run.mock.calls.slice(3)).toEqual([
    ["shutdown.exe", ["/a"]],
    ["shutdown.exe", ["/s", "/t", "2700"]],
  ]);
  expect(tools.shutdownAt()).toBe(now + 2_700_000);
  now += 2_700_000;
  expect(tools.shutdownAt()).toBeNull();
  await tools.run({ action: "shutdown", delayMinutes: 5 });
  await tools.run({ action: "cancel-shutdown" });
  expect(run.mock.calls.at(-1)).toEqual(["shutdown.exe", ["/a"]]);
  expect(tools.shutdownAt()).toBeNull();
});
it("Office adapter reads automation and command-line documents, skipping what it cannot copy", async () => {
  await expect(createOfficeCapture("linux").capture()).rejects.toMatchObject({
    code: "E_UNAVAILABLE",
  });
  const root = await mkdtemp(join(tmpdir(), "office-"));
  const line = (source: string, path: string) =>
    `${source}\t${Buffer.from(path, "utf8").toString("base64")}`;
  try {
    const saved = join(root, "课件.docx"),
      sheet = join(root, "成绩.xlsx"),
      wps = join(root, "讲义.dps");
    await writeFile(saved, "example");
    await writeFile(sheet, "sheet");
    await writeFile(wps, "slides");
    const output = [
      "garbage",
      line("ms-word", saved),
      // The same document found again on Word's command line.
      line("cmd:ms-word", saved.toUpperCase()),
      line("cmd:ms-excel", sheet),
      line("cmd:wps", wps),
      // A command-line argument without a document extension.
      line("cmd:wps", join(root, "wps.exe")),
      // Gone or unreadable files never hide the others.
      line("ms-powerpoint", join(root, "已删除.pptx")),
      line("unknown", saved),
      "",
    ].join("\r\n");
    expect(parseOpenDocuments(output).map((d) => d.path)).toEqual([
      saved,
      sheet,
      wps,
      join(root, "已删除.pptx"),
    ]);
    const result = await createOfficeCapture(
      "win32",
      async () => output,
    ).capture();
    expect(
      result.map(({ name, application, kind }) => [name, application, kind]),
    ).toEqual([
      ["课件.docx", "Microsoft Word", "word"],
      ["成绩.xlsx", "Microsoft Excel", "excel"],
      ["讲义.dps", "WPS Office", "powerpoint"],
    ]);
    expect(Buffer.from(result[0]!.bytes).toString()).toBe("example");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("clearing Office snapshots survives an automatic poll until an explicit capture", async () => {
  const f = await fixture({
    officeCapture: {
      available: true,
      capture: async () => [
        {
          name: "open.docx",
          application: "Word",
          kind: "word",
          bytes: Buffer.from("saved"),
        },
      ],
    },
  });
  try {
    await f.kernel.ops.refreshOffice();
    f.kernel.ops.clearOffice();
    expect((await f.kernel.ops.refreshOffice()).files).toEqual([]);
    expect((await f.api.ops.office.refresh({})).files).toHaveLength(1);
  } finally {
    await f.close();
  }
});
it("refuses restore while a server holds its data lock", async () => {
  const { acquireLock } = await import("@talos/launcher");
  const f = await fixture();
  let unlock: (() => Promise<void>) | undefined;
  try {
    const backup = await f.api.ops.backup.create({});
    unlock = await acquireLock(join(f.root, "server.lock"));
    await expect(
      restoreBackup(f.kernel.ops.backups.path(backup.id), f.root),
    ).rejects.toMatchObject({ code: "E_BUSY" });
  } finally {
    await unlock?.();
    await f.close();
  }
});
