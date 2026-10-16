import { describe, expect, it, vi } from "vitest";
import { RetentionScheduler, retentionDeadline } from "./retention.ts";
import type { RetentionPort } from "./retention.ts";
import type { LibraryData } from "./library-data.ts";

const DAY = 86_400_000;
const doc = (id: string) => ({
  id,
  title: `T-${id}`,
  status: "ready",
  pack: { id: id.repeat(64).slice(0, 64), size: 10 },
});
const dataOf = (
  docs: ReturnType<typeof doc>[],
  retention: Record<string, unknown>,
): LibraryData =>
  ({
    docs,
    states: new Map(),
    retentions: new Map(
      Object.entries(retention).map(([id, value]) => [
        id,
        { id, kind: "doc", value, lastUsed: 0 },
      ]),
    ),
    collections: [],
    rows: [],
  }) as unknown as LibraryData;

function setup(now = 10 * DAY) {
  const local = new Map<string, unknown>();
  const clock = { now };
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const port = {
    getSnapshot: () => ({ user: { id: "u" } }),
    getLocal: vi.fn(async (k: string) => local.get(k)),
    setLocal: vi.fn(async (k: string, v: unknown) => void local.set(k, v)),
    retainFile: vi.fn(async () => {}),
    releaseFiles: vi.fn(async () => {}),
    collectFiles: vi.fn(async () => {}),
    hasFile: vi.fn<(rid: string) => Promise<boolean>>(async () => false),
    can: vi.fn(() => ({ ok: true })),
    time: () => clock.now,
    setDownload: vi.fn(),
    downloadFile: vi.fn(async () => {}),
    delay: vi.fn((fn: () => void, ms: number) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    }),
    clearDelay: vi.fn((t: { cleared: boolean } | undefined) => {
      if (t) t.cleared = true;
    }),
    command: vi.fn(async (_m: unknown, args: { doc: string }) => {
      const d = doc(args.doc);
      return {
        document: d,
        pack: d.pack,
        download: { url: `/dl/${args.doc}` },
      };
    }),
    readFileRange: async () => undefined,
    fetchRange: async () => {
      throw new Error("unused");
    },
  };
  const scheduler = new RetentionScheduler(port as unknown as RetentionPort);
  const idle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { port, local, scheduler, clock, timers, idle };
}
const keep = (days: number, from = 0) => ({ v: days, t: { ms: from } });

describe("library retention scheduler", () => {
  it("keeps shared lists automatic until personally chosen and combines item/list clocks", async () => {
    const t = setup(DAY);
    const data = dataOf([doc("a")], {});
    data.collections.push({
      id: "shared",
      owner: "other",
      title: "shared",
      docs: ["a"],
    } as LibraryData["collections"][number]);
    t.scheduler.update({ user: "u", active: true, data });
    await t.scheduler.idle();
    expect(t.port.downloadFile).not.toHaveBeenCalled();
    data.retentions.set("shared", {
      id: "shared",
      kind: "collection",
      value: { v: 7, t: { ms: 0, counter: 0 }, op: "set" },
      lastUsed: 2 * DAY,
    });
    data.retentions.set("a", {
      id: "a",
      kind: "doc",
      value: { v: 1, t: { ms: 0, counter: 0 }, op: "set" },
      lastUsed: DAY,
    });
    expect(retentionDeadline(data, "a")).toBe(9 * DAY);
    t.scheduler.update({ user: "u", active: true, data });
    await t.scheduler.idle();
    expect(t.port.downloadFile).toHaveBeenCalledTimes(1);
    data.collections = [];
    t.scheduler.update({ user: "u", active: true, data });
    await t.scheduler.idle();
    expect(retentionDeadline(data, "a")).toBe(2 * DAY);
    t.clock.now = 3 * DAY;
    t.scheduler.update({ user: "u", active: true, data });
    await t.scheduler.idle();
    expect(t.port.releaseFiles).toHaveBeenCalledWith("library:a:retained");
  });
  it("releases a partial document after its policy becomes auto during download", async () => {
    const t = setup(DAY);
    let finish!: () => void, begin!: () => void;
    const started = new Promise<void>((resolve) => {
      begin = resolve;
    });
    t.port.downloadFile.mockImplementationOnce(() => {
      begin();
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    t.scheduler.update({
      user: "u",
      active: true,
      data: dataOf([doc("a")], { a: keep(7) }),
    });
    await started;
    t.scheduler.update({
      user: "u",
      active: true,
      data: dataOf([doc("a")], { a: { v: "auto", t: { ms: DAY } } }),
    });
    finish();
    await t.scheduler.idle();
    expect(t.port.releaseFiles).toHaveBeenCalledWith("library:a:retained");
    expect(t.local.get("library:retained")).toEqual([]);
  });

  it("downloads a retained document once, registers ownership and clears progress", async () => {
    const t = setup(1 * DAY);
    t.scheduler.update({
      user: "u",
      active: true,
      data: dataOf([doc("a")], { a: keep(7) }),
    });
    await t.idle();
    expect(t.port.downloadFile).toHaveBeenCalledWith(
      doc("a").pack.id,
      10,
      "/dl/a",
      "library:a:retained",
      expect.any(Function),
    );
    expect(t.local.get("library:retained")).toEqual([
      { doc: "a", rid: doc("a").pack.id, expires: 7 * DAY },
    ]);
    expect(t.port.setDownload).toHaveBeenCalledWith("library:a", undefined);
  });

  it("skips auto policies, expired policies, non-ready packs, present files and offline sessions", async () => {
    const t = setup(10 * DAY);
    const notReady = { ...doc("c"), status: "converting" };
    const data = dataOf([doc("a"), doc("b"), notReady, doc("d")], {
      a: { v: "auto", t: { ms: 0 } },
      b: keep(7),
      c: keep(30, 5 * DAY),
      d: keep(30, 5 * DAY),
    });
    t.port.hasFile.mockImplementation(
      async (rid: string) => rid === doc("d").pack.id,
    );
    t.scheduler.update({ user: "u", active: true, data });
    await t.idle();
    expect(t.port.downloadFile).not.toHaveBeenCalled();
    t.port.hasFile.mockResolvedValue(false);
    t.port.can.mockReturnValue({ ok: false });
    t.scheduler.update({ user: "u", active: true, data });
    await t.idle();
    expect(t.port.downloadFile).not.toHaveBeenCalled();
  });

  it("does nothing while locked or signed out", async () => {
    const t = setup(1 * DAY);
    const data = dataOf([doc("a")], { a: keep(7) });
    t.scheduler.update({ user: "u", active: false, data });
    t.scheduler.update({ user: undefined, active: true, data });
    await t.idle();
    expect(t.port.getLocal).not.toHaveBeenCalled();
  });

  it("releases an expired retention and forgets the cached description of a deleted document", async () => {
    const t = setup(20 * DAY);
    t.port.hasFile.mockResolvedValue(true);
    t.local.set("library:retained", [
      { doc: "gone", pack: "p", expires: 5 * DAY },
      { doc: "a", pack: "q", expires: 8 * DAY },
      { doc: "live", rid: doc("l").pack.id, expires: 30 * DAY },
    ]);
    t.scheduler.update({
      user: "u",
      active: true,
      data: dataOf(
        [doc("a"), doc("l")].map((d) =>
          d.id === "l" ? { ...d, id: "live" } : d,
        ),
        {
          a: keep(7),
          live: keep(30, 0),
        },
      ),
    });
    await t.idle();
    expect(t.port.releaseFiles).toHaveBeenCalledWith("library:gone:retained");
    expect(t.port.releaseFiles).toHaveBeenCalledWith("library:a:retained");
    expect(t.port.releaseFiles).not.toHaveBeenCalledWith(
      "library:live:retained",
    );
    expect(t.local.get("library:retained")).toEqual([
      { doc: "live", rid: doc("l").pack.id, expires: 30 * DAY },
    ]);
    expect(
      [...t.local.entries()].some(([k, v]) => k.includes("gone") && v === null),
    ).toBe(true);
    expect(t.port.collectFiles).toHaveBeenCalled();
  });

  it("records a failed download against the document and carries on with the next", async () => {
    const t = setup(1 * DAY);
    t.port.downloadFile.mockRejectedValueOnce(new Error("磁盘已满"));
    t.scheduler.update({
      user: "u",
      active: true,
      data: dataOf([doc("a"), doc("b")], { a: keep(7), b: keep(7) }),
    });
    await t.idle();
    expect(t.port.setDownload).toHaveBeenCalledWith("library:a", {
      title: "T-a",
      progress: 0,
      error: "磁盘已满",
    });
    expect(t.port.downloadFile).toHaveBeenCalledTimes(2);
  });

  it("releases a file whose retention lapsed during its download", async () => {
    const t = setup(1 * DAY);
    t.port.downloadFile.mockImplementationOnce(async () => {
      t.clock.now = 8 * DAY;
    });
    t.scheduler.update({
      user: "u",
      active: true,
      data: dataOf([doc("a")], { a: keep(7) }),
    });
    await t.idle();
    expect(t.port.releaseFiles).toHaveBeenCalledWith("library:a:retained");
  });

  it("reports progress as a fraction and treats an unknown total as complete", async () => {
    const t = setup(1 * DAY);
    t.port.downloadFile.mockImplementationOnce(async (...args: unknown[]) => {
      const cb = args[4] as (w: number, t: number) => void;
      cb(5, 10);
      cb(0, 0);
    });
    t.scheduler.update({
      user: "u",
      active: true,
      data: dataOf([doc("a")], { a: keep(7) }),
    });
    await t.idle();
    const calls = t.port.setDownload.mock.calls.map((c) => c[1]?.progress);
    expect(calls).toContain(0.5);
    expect(calls).toContain(1);
  });

  it("schedules a re-run at the nearest expiry (capped for setTimeout) and stop cancels it", async () => {
    const t = setup(1 * DAY);
    const data = dataOf([doc("a"), doc("b")], { a: keep(7), b: keep(3) });
    t.scheduler.update({ user: "u", active: true, data });
    await t.scheduler.idle();
    expect(t.timers).toHaveLength(1);
    expect(t.timers[0]!.ms).toBe(
      3 * DAY - 1 * DAY > 2_147_483_647 ? 2_147_483_647 : 2 * DAY,
    );
    t.scheduler.update({ user: "u", active: true, data });
    await t.scheduler.idle();
    expect(t.timers[0]!.cleared).toBe(true);
    t.scheduler.stop();
    expect(t.timers[1]!.cleared).toBe(true);
    const far = setup(0);
    far.scheduler.update({
      user: "u",
      active: true,
      data: dataOf([doc("a")], { a: keep(365 * 10) }),
    });
    await far.scheduler.idle();
    expect(far.timers[0]!.ms).toBe(2_147_483_647);
  });

  it("a superseding update cancels the pass in flight before it fetches another document", async () => {
    const t = setup(1 * DAY);
    let release!: () => void;
    t.port.downloadFile.mockImplementationOnce(
      () => new Promise<void>((r) => (release = r)),
    );
    const data = dataOf([doc("a"), doc("b")], { a: keep(7), b: keep(7) });
    t.scheduler.update({ user: "u", active: true, data });
    await t.idle();
    t.scheduler.update({ user: "u", active: false, data });
    release();
    await t.idle();
    expect(t.port.downloadFile).toHaveBeenCalledTimes(1);
  });
});

it("preserves retained bytes and metadata while cache knowledge is incomplete, then reconciles after recovery", async () => {
  const t = setup(DAY);
  const retained = [{ doc: "a", rid: doc("a").pack.id, expires: 10 * DAY }];
  t.local.set("library:retained", retained);
  t.local.set("library:doc:a", { cached: true });
  for (const offline of [false, true]) {
    t.scheduler.update({
      user: "u",
      active: true,
      syncing: true,
      offline,
      data: dataOf([], {}),
    });
    await t.scheduler.idle();
    expect(t.port.releaseFiles).not.toHaveBeenCalled();
    expect(t.port.collectFiles).not.toHaveBeenCalled();
    expect(t.local.get("library:retained")).toEqual(retained);
  }
  t.scheduler.update({
    user: "u",
    active: true,
    syncing: false,
    offline: true,
    data: dataOf([], {}),
  });
  await t.scheduler.idle();
  expect(t.port.releaseFiles).toHaveBeenCalledWith("library:a:retained");
  expect(t.local.get("library:retained")).toEqual([]);
});
