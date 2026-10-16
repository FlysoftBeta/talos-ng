import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLibraryState } from "@talos/contract";
import type { LibraryDoc } from "@talos/contract";
import {
  ReadingSession,
  readerDetails,
  retentionChoice,
  retentionStatus,
  retentionValue,
} from "./reading-session.ts";
import type {
  PageVisibility,
  ReaderInput,
  ReaderPort,
} from "./reading-session.ts";

const opened = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("./resources.ts", () => ({ openDocument: opened.open }));

const doc = {
  id: "doc",
  title: "文档",
  status: "ready",
  kind: "flow",
  units: 10,
  pack: { id: "p", size: 1 },
} as unknown as LibraryDoc;
interface Timer {
  id: number;
  at: number;
  run: () => void;
}
function harness() {
  let now = 0,
    next = 1,
    hidden = false;
  const timers = new Map<number, Timer>(),
    listeners = new Set<() => void>(),
    commands: { method: { name: string }; args: Record<string, unknown> }[] =
      [],
    guards: (() => boolean)[] = [];
  const port = {
    time: () => now,
    delay: (run: () => void, ms: number) => {
      timers.set(next, { id: next, at: now + ms, run });
      return next++;
    },
    clearDelay: (id: number) => void timers.delete(id),
    operation: () => ({ op: "op", t: { ms: now, counter: 0 } }),
    command: async (
      method: { name: string },
      args: Record<string, unknown>,
    ) => {
      commands.push({ method, args });
      return {};
    },
    dispatch: vi.fn(),
    navigationGuards: {
      add: (guard: () => boolean) => {
        guards.push(guard);
        return () => void guards.splice(guards.indexOf(guard), 1);
      },
    },
    hasFile: async () => false,
  } as unknown as ReaderPort;
  const visibility: PageVisibility = {
    hidden: () => hidden,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return {
    port,
    visibility,
    commands,
    guards,
    advance(ms: number) {
      now += ms;
      for (const t of Array.from(timers.values()))
        if (t.at <= now) {
          timers.delete(t.id);
          t.run();
        }
    },
    hide(value: boolean) {
      hidden = value;
      listeners.forEach((l) => l());
    },
  };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const input = (patch: Partial<ReaderInput> = {}): ReaderInput => ({
  doc,
  state: emptyLibraryState("doc"),
  readable: true,
  canOpen: true,
  device: "dev",
  foreground: true,
  downloads: [],
  ...patch,
});
const progress = (h: ReturnType<typeof harness>) =>
  h.commands.filter((c) => c.method.name === "library.progress.set");
beforeEach(() => opened.open.mockReset().mockResolvedValue({ loaded: true }));

describe("reading session progress", () => {
  it("counts only visible foreground time and keeps the furthest unit when moving back", async () => {
    const h = harness(),
      session = new ReadingSession("doc", h.port, h.visibility, input());
    session.start();
    session.update(input());
    await flush();
    expect(session.getState().resources).toEqual({ loaded: true });
    session.positionChanged({ unit: 6, offset: 5 });
    h.advance(500);
    session.positionChanged({ unit: 2, offset: 40 });
    h.advance(500);
    await flush();
    expect(progress(h)).toHaveLength(2);
    expect(progress(h)[1]!.args).toMatchObject({
      resume: { v: { unit: 2, offset: 40 } },
      furthest: 6,
      seconds: 1,
    });
    h.hide(true);
    h.advance(60000);
    h.hide(false);
    h.advance(15000);
    await flush();
    const last = progress(h).at(-1)!.args;
    expect(last.seconds).toBe(16);
    expect(last.furthest).toBe(6);
    session.dispose();
  });
  it("saves immediately when hidden and never while the account may not read", async () => {
    const h = harness(),
      session = new ReadingSession("doc", h.port, h.visibility, input());
    session.start();
    session.update(input());
    await flush();
    h.hide(true);
    await flush();
    expect(progress(h)).toHaveLength(1);
    session.update(input({ readable: false }));
    h.hide(false);
    h.hide(true);
    await flush();
    expect(progress(h)).toHaveLength(1);
    session.dispose();
  });
  it("flushes the position before navigation and on close", async () => {
    const h = harness(),
      session = new ReadingSession("doc", h.port, h.visibility, input());
    session.start();
    session.update(input());
    await flush();
    session.positionChanged({ unit: 1, offset: 3 });
    expect(h.guards[0]!()).toBe(true);
    await flush();
    expect(progress(h)).toHaveLength(1);
    session.dispose();
    await flush();
    expect(progress(h)).toHaveLength(2);
    expect(h.guards).toHaveLength(0);
  });
});
describe("reading session loading", () => {
  it("reports a failed open and retries it", async () => {
    const h = harness(),
      session = new ReadingSession("doc", h.port, h.visibility, input());
    opened.open.mockRejectedValueOnce(new Error("读取失败了"));
    session.start();
    session.update(input());
    await flush();
    expect(session.getState().error).toBe("读取失败了");
    session.retry();
    await flush();
    expect(session.getState().error).toBe("");
    expect(session.getState().resources).toEqual({ loaded: true });
    session.dispose();
  });
  it("does not open a document that is still converting", async () => {
    const h = harness(),
      session = new ReadingSession("doc", h.port, h.visibility, input());
    session.start();
    session.update(
      input({ doc: { ...doc, status: "processing" } as LibraryDoc }),
    );
    await flush();
    expect(opened.open).not.toHaveBeenCalled();
    session.dispose();
  });
});

describe("reading session edge cases", () => {
  it("ignores an open that resolves after a newer state superseded it", async () => {
    const h = harness(),
      session = new ReadingSession("doc", h.port, h.visibility, input());
    let release!: (v: unknown) => void;
    opened.open.mockReturnValueOnce(
      new Promise((resolve) => (release = resolve)),
    );
    session.start();
    session.update(input());
    // the document stops being readable (e.g. lock) before the open finishes
    session.update(input({ readable: false }));
    release({ stale: true });
    await flush();
    expect(session.getState().resources).toBeUndefined();
    session.dispose();
  });

  it("reports a failed progress save without losing the position, and a later save succeeds", async () => {
    const h = harness(),
      session = new ReadingSession("doc", h.port, h.visibility, input());
    session.start();
    session.update(input());
    await flush();
    const original = h.port.command;
    (h.port as { command: unknown }).command = async () => {
      throw new Error("离线");
    };
    session.positionChanged({ unit: 3, offset: 4 });
    h.advance(500);
    await flush();
    expect(session.getState().error).toBe("离线");
    (h.port as { command: unknown }).command = original;
    h.advance(500);
    session.positionChanged({ unit: 5, offset: 0 });
    h.advance(500);
    await flush();
    expect(progress(h).at(-1)!.args).toMatchObject({
      furthest: 5,
      device: "dev",
    });
    session.dispose();
  });

  it("debounces rapid movement into one save of the final position", async () => {
    const h = harness(),
      session = new ReadingSession("doc", h.port, h.visibility, input());
    session.start();
    session.update(input());
    await flush();
    for (const unit of [1, 2, 3, 4]) {
      session.positionChanged({ unit, offset: 0 });
      h.advance(100);
    }
    h.advance(500);
    await flush();
    const saves = progress(h);
    expect(saves).toHaveLength(1);
    expect(saves[0]!.args).toMatchObject({ furthest: 4 });
    session.dispose();
  });

  it("never lets stored seconds go backwards when another device accumulated more", async () => {
    const h = harness(),
      state = { ...emptyLibraryState("doc"), seconds: { dev: 500 } };
    const session = new ReadingSession(
      "doc",
      h.port,
      h.visibility,
      input({ state }),
    );
    session.start();
    session.update(input({ state }));
    await flush();
    session.positionChanged({ unit: 1, offset: 0 });
    h.advance(500);
    await flush();
    expect(progress(h)[0]!.args.seconds).toBeGreaterThanOrEqual(500);
    session.dispose();
  });

  it("toggles a synced favourite even when the membership stamp is ahead of the device clock", async () => {
    const h = harness();
    const state = {
      ...emptyLibraryState("doc"),
      favourite: { v: true, t: { ms: 50_000, counter: 8 }, op: "remote" },
    };
    const session = new ReadingSession(
      "doc",
      h.port,
      h.visibility,
      input({ state }),
    );
    await session.toggleFavourite();
    expect(h.commands[0]!.args).toMatchObject({
      value: { v: false, t: { ms: 50_000, counter: 9 } },
    });
    session.dispose();
  });
  it("toggles favourite, saves retention and deletes with error reporting", async () => {
    const h = harness(),
      session = new ReadingSession("doc", h.port, h.visibility, input());
    session.start();
    session.update(input());
    await flush();
    await session.toggleFavourite();
    expect(h.commands.at(-1)!.args).toMatchObject({ value: { v: true } });
    expect(await session.saveRetention("7")).toBe(true);
    expect(h.commands.at(-1)!.args).toMatchObject({ value: { v: 7 } });
    expect(await session.deleteDocument()).toBe(true);
    expect(h.port.dispatch).toHaveBeenCalledWith({ type: "back" });
    (h.port as { command: unknown }).command = async () => {
      throw new Error("拒绝");
    };
    expect(await session.saveRetention("auto")).toBe(false);
    expect(session.getState().error).toBe("拒绝");
    expect(await session.deleteDocument()).toBe(false);
    await session.toggleFavourite();
    session.back();
    session.showTasks();
    expect(h.port.dispatch).toHaveBeenLastCalledWith({
      type: "openOverlay",
      overlay: { kind: "tasks" },
    });
    session.dispose();
  });

  it("tracks whether the complete pack is stored on this device", async () => {
    const h = harness(),
      session = new ReadingSession("doc", h.port, h.visibility, input());
    (h.port as { hasFile: unknown }).hasFile = async () => true;
    session.start();
    session.update(input());
    await flush();
    expect(session.getState().retained).toBe(true);
    session.dispose();
  });
});

describe("reader presentation helpers", () => {
  it("maps retention choices to wire values and labels", () => {
    expect(retentionValue("auto")).toBe("auto");
    expect(retentionValue("180")).toBe(180);
    expect(retentionChoice(undefined)).toBe("auto");
    expect(retentionStatus(true, [], "d")).toContain("已保留");
    expect(retentionStatus(false, [{ id: "library:d" }], "d")).toContain(
      "下载中",
    );
    expect(retentionStatus(false, [{ id: "library:x" }], "d")).toContain(
      "尚未下载",
    );
  });
  it("describes a document with the owner's name, clamped furthest and summed seconds", () => {
    const state = {
      ...emptyLibraryState("doc"),
      furthest: 99,
      seconds: { a: 10, b: 5 },
    };
    const details = readerDetails(
      {
        ...doc,
        kind: "paged",
        owner: "me",
        created: 0,
      } as unknown as LibraryDoc,
      state,
      { id: "me", name: "我" },
    );
    expect(details).toMatchObject({
      author: "我",
      sizeLabel: "页数",
      size: 10,
      furthest: "10 / 10",
      seconds: 15,
    });
    expect(
      readerDetails(
        { ...doc, owner: "x", chars: 7, created: 0 } as unknown as LibraryDoc,
        state,
        undefined,
      ),
    ).toMatchObject({ author: "x", sizeLabel: "字数", size: 7 });
  });
});
