import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AppError, deferred } from "@talos/base";
import {
  createFsObjectStore,
  hashStream,
  isObjectId,
  objectPath,
} from "../index.ts";
import { collect } from "../testing/conformance.ts";
import type { ManagedObjectStore } from "../index.ts";

let root: string;
let store: ManagedObjectStore;
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "talos-fs-objects-"));
  store = createFsObjectStore({ root });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
const failure = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(code), { code });

it("hash helpers and path layout validate canonical ids", async () => {
  const info = await hashStream(Uint8Array.of(97, 98, 99));
  expect(info).toEqual({
    id: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    size: 3,
  });
  expect(objectPath(root, info.id)).toBe(
    join(root, "objects", "ba", "78", info.id),
  );
  for (const value of [
    null,
    undefined,
    12,
    {},
    "",
    info.id.toUpperCase(),
    info.id + "\n",
  ])
    expect(isObjectId(value)).toBe(false);
  expect(() => objectPath(root, "../../bad")).toThrow(AppError);
});

it("invalid identifiers cause no filesystem access or root creation", async () => {
  const nested = join(root, "uncreated");
  const fresh = createFsObjectStore({ root: nested });
  const mkdir = vi.spyOn(fs, "mkdir"),
    open = vi.spyOn(fs, "open"),
    stat = vi.spyOn(fs, "lstat");
  await expect(fresh.stage("../bad")).rejects.toMatchObject({
    code: "E_INVALID",
  });
  await expect(
    fresh.put(Uint8Array.of(1), { id: "bad" }),
  ).rejects.toMatchObject({ code: "E_INVALID" });
  for (const op of [
    fresh.has,
    fresh.stat,
    fresh.open,
    fresh.delete,
    fresh.readAll,
    fresh.verify,
  ])
    await expect(op("../bad")).rejects.toMatchObject({ code: "E_INVALID" });
  expect(mkdir).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  expect(stat).not.toHaveBeenCalled();
  expect(() => createFsObjectStore({ root: "" })).toThrow(AppError);
});

it("resumes a stage left on disk by a prior process", async () => {
  await fs.mkdir(join(root, "stages"));
  await fs.writeFile(join(root, "stages", "crashed"), Uint8Array.of(1, 2, 3));
  const restarted = createFsObjectStore({ root });
  const stage = await restarted.stage("crashed");
  expect(stage.size).toBe(3);
  await stage.append(Uint8Array.of(4), 3);
  const info = await stage.commit();
  expect(await restarted.readAll(info.id)).toEqual(Uint8Array.of(1, 2, 3, 4));
  expect(await fs.readdir(join(root, "stages"))).toEqual([]);
});

it("acknowledged appends survive a new store instance", async () => {
  await (await store.stage("restart")).append(Uint8Array.of(3, 4), 0);
  const restarted = createFsObjectStore({ root });
  const stage = await restarted.stage("restart");
  expect(stage.size).toBe(2);
  expect(await stage.commit()).toEqual(await hashStream(Uint8Array.of(3, 4)));
});

it("detects flipped bytes and re-hashes stage contents at commit", async () => {
  const info = await store.put(Uint8Array.of(1, 2, 3));
  await fs.writeFile(store.localPath(info.id)!, Uint8Array.of(1, 8, 3));
  expect(await store.verify(info.id)).toBe(false);
  const stage = await store.stage("rehash");
  await stage.append(Uint8Array.of(1, 2, 3), 0);
  await fs.writeFile(join(root, "stages", "rehash"), Uint8Array.of(1, 7, 3));
  await expect(stage.commit(info)).rejects.toMatchObject({
    code: "E_INTEGRITY",
  });
  expect(await stage.commit()).toEqual(
    await hashStream(Uint8Array.of(1, 7, 3)),
  );
});

it("reports truncation through an open reader as integrity failure", async () => {
  const info = await store.put(Uint8Array.of(1, 2, 3));
  const reader = await store.open(info.id);
  try {
    await fs.truncate(objectPath(root, info.id), 1);
    await expect(reader.read(0, 3)).rejects.toMatchObject({
      code: "E_INTEGRITY",
    });
  } finally {
    await reader.close();
  }
});

it("list ignores foreign files, wrong fanout and directories; handles early return", async () => {
  const info = await store.put(Uint8Array.of(1));
  const path = objectPath(root, info.id);
  await fs.writeFile(join(root, "objects", "notes"), "foreign");
  await fs.writeFile(join(dirname(path), "bad"), "foreign");
  const wrongId = "0".repeat(64);
  await fs.writeFile(join(dirname(path), wrongId), "wrong fanout");
  await fs.mkdir(join(dirname(path), "1".repeat(64)));
  expect((await collect(store.list())).map((item) => item.id)).toEqual([
    info.id,
  ]);
  for await (const item of store.list()) {
    expect(item.id).toBe(info.id);
    break;
  }
  expect(await store.delete(info.id)).toBe(true);
});

it("cleans private stages after source errors and failed expectations", async () => {
  async function* src() {
    yield Uint8Array.of(1);
    throw new AppError("E_CANCELLED", "cancel");
  }
  await expect(store.put(src())).rejects.toMatchObject({ code: "E_CANCELLED" });
  await expect(store.put(Uint8Array.of(2), { size: 3 })).rejects.toMatchObject({
    code: "E_INTEGRITY",
  });
  expect(await fs.readdir(join(root, "stages"))).toEqual([]);
  expect(await collect(store.list())).toEqual([]);
});

it("sweeps abandoned private stages but protects an in-progress put", async () => {
  let now = Date.now();
  store = createFsObjectStore({ root, clock: () => now });
  await fs.mkdir(join(root, "stages"));
  const abandoned = join(
    root,
    "stages",
    ".put-12345678-1234-1234-1234-123456789abc",
  );
  await fs.writeFile(abandoned, "unfinished");
  await fs.utimes(abandoned, 1, 1);
  await fs.writeFile(join(root, "stages", "foreign.txt"), "leave me");
  const started = deferred<void>(),
    resume = deferred<void>();
  async function* src() {
    yield Uint8Array.of(1);
    started.resolve();
    await resume.promise;
    yield Uint8Array.of(2);
  }
  const putting = store.put(src());
  await started.promise;
  try {
    now += 100_000;
    expect(await store.sweepStages(1000)).toBe(1);
  } finally {
    resume.resolve();
  }
  const info = await putting;
  expect(await store.readAll(info.id)).toEqual(Uint8Array.of(1, 2));
  expect(await fs.readdir(join(root, "stages"))).toEqual(["foreign.txt"]);
});

it("stream handles close after early return, consumer throw, invalid range and I/O failure", async () => {
  const info = await store.put(new Uint8Array(300_000));
  const original = fs.open.bind(fs);
  const closes: ReturnType<typeof vi.spyOn>[] = [];
  vi.spyOn(fs, "open").mockImplementation(
    async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      closes.push(vi.spyOn(handle, "close"));
      return handle;
    },
  );
  for await (const part of store.read(info.id)) {
    expect(part.length).toBe(128 * 1024);
    break;
  }
  await expect(
    (async () => {
      for await (const part of store.read(info.id)) {
        expect(part.length).toBeGreaterThan(0);
        throw new Error("consumer");
      }
    })(),
  ).rejects.toThrow("consumer");
  await expect(
    store.readAll(info.id, { start: 0, end: 999_999 }),
  ).rejects.toMatchObject({ code: "E_INVALID" });
  expect(closes).toHaveLength(3);
  for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
});

it("closes handles on read failures and stat failures after opening", async () => {
  const info = await store.put(Uint8Array.of(1));
  const original = fs.open.bind(fs);
  const closes: ReturnType<typeof vi.spyOn>[] = [];
  let failStat = false;
  vi.spyOn(fs, "open").mockImplementation(
    async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      closes.push(vi.spyOn(handle, "close"));
      if (failStat) vi.spyOn(handle, "stat").mockRejectedValue(failure("EIO"));
      else vi.spyOn(handle, "read").mockRejectedValue(failure("EIO"));
      return handle;
    },
  );
  await expect(store.readAll(info.id)).rejects.toMatchObject({
    code: "E_INTERNAL",
  });
  failStat = true;
  await expect(store.open(info.id)).rejects.toMatchObject({
    code: "E_INTERNAL",
  });
  for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
});

it("sync failure never publishes a put and closes its stage handle", async () => {
  const original = fs.open.bind(fs);
  const closes: ReturnType<typeof vi.spyOn>[] = [];
  vi.spyOn(fs, "open").mockImplementation(
    async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      closes.push(vi.spyOn(handle, "close"));
      vi.spyOn(handle, "sync").mockRejectedValue(failure("EIO"));
      return handle;
    },
  );
  await expect(store.put(Uint8Array.of(1))).rejects.toMatchObject({
    code: "E_INTERNAL",
  });
  expect(await collect(store.list())).toEqual([]);
  expect(await fs.readdir(join(root, "stages"))).toEqual([]);
  for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
});

it("fsync can be disabled explicitly", async () => {
  store = createFsObjectStore({ root, fsync: false });
  const original = fs.open.bind(fs);
  const syncs: ReturnType<typeof vi.spyOn>[] = [];
  vi.spyOn(fs, "open").mockImplementation(
    async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      syncs.push(vi.spyOn(handle, "sync"));
      return handle;
    },
  );
  const stage = await store.stage("no-sync");
  await stage.append(Uint8Array.of(1), 0);
  await stage.commit();
  await store.put(Uint8Array.of(2));
  for (const sync of syncs) expect(sync).not.toHaveBeenCalled();
});

it("rename failure leaves no partial published object and permits stage retry", async () => {
  const stage = await store.stage("rename-failure");
  await stage.append(Uint8Array.of(1), 0);
  const rename = vi.spyOn(fs, "rename").mockRejectedValue(failure("EIO"));
  await expect(stage.commit()).rejects.toMatchObject({ code: "E_INTERNAL" });
  await expect(store.put(Uint8Array.of(2))).rejects.toMatchObject({
    code: "E_INTERNAL",
  });
  expect(await collect(store.list())).toEqual([]);
  expect(await fs.readdir(join(root, "stages"))).toEqual(["rename-failure"]);
  rename.mockRestore();
  expect(await stage.commit()).toEqual(await hashStream(Uint8Array.of(1)));
});

it("same-content put does not rename over an open destination", async () => {
  const info = await store.put(Uint8Array.of(1));
  const reader = await store.open(info.id),
    rename = vi.spyOn(fs, "rename");
  try {
    await store.put(Uint8Array.of(1));
    expect(rename).not.toHaveBeenCalled();
    expect(await reader.read(0, 1)).toEqual(Uint8Array.of(1));
  } finally {
    await reader.close();
  }
});

describe("Windows-compatible deletion failure injection", () => {
  for (const code of ["EBUSY", "EPERM"])
    it(`retries ${code}, moves to trash and sweeps later`, async () => {
      const delay = vi.fn<(ms: number) => Promise<void>>(async () => {});
      store = createFsObjectStore({ root, delay });
      const info = await store.put(Uint8Array.of(1)),
        target = objectPath(root, info.id);
      const original = fs.unlink.bind(fs);
      const unlink = vi.spyOn(fs, "unlink").mockImplementation(async (path) => {
        if (path === target) throw failure(code);
        return original(path);
      });
      expect(await store.delete(info.id)).toBe(true);
      expect(delay.mock.calls.map(([ms]) => ms)).toEqual([10, 20]);
      expect(await store.has(info.id)).toBe(false);
      expect(await fs.readdir(join(root, "trash"))).toHaveLength(1);
      unlink.mockRejectedValue(failure(code));
      expect(await store.sweepTrash()).toBe(0);
      unlink.mockRestore();
      expect(await store.sweepTrash()).toBe(1);
      expect(await store.sweepTrash()).toBe(0);
    });
  it("returns success after transient busy errors without using trash", async () => {
    const delay = vi.fn<(ms: number) => Promise<void>>(async () => {});
    store = createFsObjectStore({ root, delay });
    const info = await store.put(Uint8Array.of(2));
    vi.spyOn(fs, "unlink").mockRejectedValueOnce(failure("EBUSY"));
    expect(await store.delete(info.id)).toBe(true);
    expect(delay).toHaveBeenCalledTimes(1);
    await expect(fs.stat(join(root, "trash"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("reports E_BUSY if Windows denies both unlink and rename", async () => {
    store = createFsObjectStore({ root, delay: async () => {} });
    const info = await store.put(Uint8Array.of(3));
    vi.spyOn(fs, "unlink").mockRejectedValue(failure("EPERM"));
    vi.spyOn(fs, "rename").mockRejectedValue(failure("EPERM"));
    await expect(store.delete(info.id)).rejects.toMatchObject({
      code: "E_BUSY",
    });
    expect(await store.has(info.id)).toBe(true);
  });
  it("does not conceal unrelated I/O failures as successful deletes", async () => {
    const info = await store.put(Uint8Array.of(4));
    vi.spyOn(fs, "unlink").mockRejectedValue(failure("EACCES"));
    await expect(store.delete(info.id)).rejects.toMatchObject({
      code: "E_DENIED",
    });
    expect(await store.has(info.id)).toBe(true);
  });
});

it("streams a 64 MiB object with bounded heap growth", async () => {
  const size = 64 * 1024 * 1024,
    chunk = new Uint8Array(128 * 1024).fill(37);
  const baseline = process.memoryUsage().heapUsed;
  let peak = baseline;
  const sample = (): void => {
    peak = Math.max(peak, process.memoryUsage().heapUsed);
  };
  async function* source() {
    for (let at = 0; at < size; at += chunk.length) {
      sample();
      yield chunk;
    }
  }
  const expected = await hashStream(source());
  const info = await store.put(source(), expected);
  expect(info.size).toBe(size);
  let read = 0;
  for await (const part of store.read(info.id)) {
    sample();
    expect(part.length).toBeLessThanOrEqual(256 * 1024);
    read += part.length;
  }
  expect(read).toBe(size);
  expect(await store.verify(info.id)).toBe(true);
  expect(peak - baseline).toBeLessThan(32 * 1024 * 1024);
}, 20_000);

it("bulk sync failures reject the batch, replay repairs torn objects, and ordinary puts remain durable", async () => {
  const batch = store.beginBulk!();
  const bytes = Buffer.from("bulk-object");
  const info = await batch.put(bytes);
  const open = fs.open.bind(fs);
  const synced: string[] = [];
  const spy = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args);
    const sync = handle.sync.bind(handle);
    handle.sync = async () => {
      synced.push(String(args[0]));
      await sync();
    };
    return handle;
  });
  // Deduplicating a normal upload against an uncommitted batch still syncs it.
  expect(await store.put(bytes)).toEqual(info);
  expect(synced).toContain(store.localPath(info.id));
  spy.mockRestore();
  const broken = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    if (String(args[0]) === store.localPath(info.id)) throw failure("EIO");
    return open(...args);
  });
  await expect(batch.commit()).rejects.toMatchObject({ code: "EIO" });
  broken.mockRestore();
  await fs.writeFile(store.localPath(info.id)!, Buffer.from("torn"));
  const replay = createFsObjectStore({ root }).beginBulk!();
  expect(await replay.put(bytes)).toEqual(info);
  await replay.commit();
  expect(await store.verify(info.id)).toBe(true);
  await expect(replay.put(bytes)).rejects.toMatchObject({ code: "E_CONFLICT" });
});
