import { describe, expect, it, vi } from "vitest";
import { AppError } from "@talos/base";
import { NetbooksController, canSearch } from "./netbooks-controller.ts";
import type { NetbooksPort } from "./netbooks-controller.ts";
import { remainingSeconds } from "./cooldown.ts";

function setup(
  command: (method: { name: string }, args: unknown) => Promise<unknown>,
) {
  let now = 1000;
  const timers = new Map<number, () => void>();
  let id = 0;
  const port = {
    command: vi.fn(command),
    time: () => now,
    delay: (run: () => void) => {
      timers.set(++id, run);
      return id;
    },
    clearDelay: (handle: number) => void timers.delete(handle),
    dispatch: vi.fn(),
  } as unknown as NetbooksPort;
  return {
    port,
    controller: new NetbooksController(port),
    advance(ms: number) {
      now += ms;
      for (const [key, run] of Array.from(timers)) {
        timers.delete(key);
        run();
      }
    },
  };
}
const book = { id: "b1", title: "书", author: "作者", abstract: "简介" };

describe("network books search cooldown", () => {
  it("starts a server-driven cooldown after a search and counts it down", async () => {
    const t = setup(async () => ({
      books: [book],
      retryAt: 6000,
      serverTime: 1000,
    }));
    t.controller.setQuery("红楼");
    await t.controller.search();
    const state = t.controller.getState();
    expect(state.books).toEqual([book]);
    expect(remainingSeconds(state.deadline, state.now)).toBe(5);
    expect(canSearch(state, undefined)).toBe(false);
    t.advance(5000);
    const later = t.controller.getState();
    expect(remainingSeconds(later.deadline, later.now)).toBe(0);
    expect(canSearch(later, undefined)).toBe(true);
  });
  it("turns a busy refusal into an error plus the server's retry time", async () => {
    const t = setup(async () => {
      throw new AppError("E_BUSY", "请稍后", {
        retryAt: 4000,
        serverTime: 1000,
      });
    });
    t.controller.setQuery("x");
    await t.controller.search();
    const state = t.controller.getState();
    expect(state.error).toBe("请稍后");
    expect(remainingSeconds(state.deadline, state.now)).toBe(3);
    expect(state.busy).toBe(false);
  });
  it("serialises requests", async () => {
    let release: (value: unknown) => void = () => {};
    const t = setup(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    t.controller.setQuery("x");
    const first = t.controller.search();
    await t.controller.search();
    expect(t.port.command).toHaveBeenCalledTimes(1);
    release({ books: [], retryAt: 0, serverTime: 0 });
    await first;
    expect(t.controller.getState().busy).toBe(false);
  });
});
describe("network books download", () => {
  it("records the job and tells joined from started downloads", async () => {
    const t = setup(async () => ({ job: "j1", joined: true }));
    t.controller.setCollection("c1");
    await t.controller.download("b1");
    expect(t.port.command).toHaveBeenCalledWith(
      expect.objectContaining({ name: "netbooks.download" }),
      { book: "b1", collection: "c1" },
    );
    expect(t.controller.getState().submitted).toEqual({ b1: "j1" });
    expect(t.controller.getState().notice).toContain("已加入");
    expect(t.controller.getState().downloading).toBeUndefined();
  });
  it("ignores a result that arrives after the dialog closed", async () => {
    let release: (value: unknown) => void = () => {};
    const t = setup(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = t.controller.download("b1");
    t.controller.dispose();
    release({ job: "j1", joined: false });
    await pending;
    expect(t.controller.getState().submitted).toEqual({});
  });
});
