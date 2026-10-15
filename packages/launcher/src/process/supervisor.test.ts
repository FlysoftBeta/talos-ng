import { describe, it, expect } from "vitest";
import { Supervisor } from "./supervisor.ts";
import type { LauncherState, ServerChild } from "./supervisor.ts";
function fixture(initial: LauncherState = { current: "A" }) {
  let state = initial,
    now = 1000;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let next = 0;
  const children: {
      build: string;
      exit: () => void;
      message: (m: unknown) => void;
      stopped: boolean;
    }[] = [],
    incidents: string[] = [],
    restores: string[] = [];
  const s = new Supervisor({
    now: () => now,
    schedule: (fn, ms) => {
      timers.set(++next, { fn, at: now + ms });
      return next;
    },
    cancel: (t) => {
      timers.delete(t as number);
    },
    read: async () => structuredClone(state),
    save: async (value) => {
      state = structuredClone(value);
    },
    incident: async (m) => {
      incidents.push(m);
    },
    restore: async (path) => {
      restores.push(path);
    },
    start: async (build): Promise<ServerChild> => {
      const child = {
        build,
        exit: () => {},
        message: (_m: unknown) => {
          void _m;
        },
        stopped: false,
      };
      children.push(child);
      return {
        stop: async () => {
          child.stopped = true;
          child.exit();
        },
        onExit: (fn) => {
          child.exit = fn;
        },
        onMessage: (fn) => {
          child.message = fn;
        },
      };
    },
  });
  return {
    s,
    children,
    incidents,
    restores,
    state: () => state,
    timers,
    async tick(ms: number) {
      now += ms;
      for (const [id, t] of [...timers])
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      await s.idle();
    },
  };
}
describe("launcher supervisor", () => {
  it("confirms B and stops exactly the old child", async () => {
    const f = fixture();
    await f.s.boot();
    await f.s.apply("B", "backup");
    expect(f.children[0]!.stopped).toBe(true);
    expect(f.state().pending?.previous).toBe("A");
    f.children[1]!.message({ type: "confirmed" });
    await f.s.idle();
    expect(f.state()).toEqual({ current: "B" });
    await f.tick(180001);
    expect(f.restores).toEqual([]);
    await f.s.stop();
  });
  it("rolls back database and pointer at the original deadline", async () => {
    const f = fixture();
    await f.s.boot();
    await f.s.apply("C", "saved.zip");
    await f.tick(180000);
    expect(f.restores).toEqual(["saved.zip"]);
    expect(f.state()).toEqual({ current: "A" });
    expect(f.incidents[0]).toContain("回滚 C");
    expect(f.children[1]!.stopped).toBe(true);
  });
  it("recovers expired pending state after launcher restart", async () => {
    const f = fixture({
      current: "B",
      pending: { build: "B", previous: "A", backup: "saved", deadline: 900 },
    });
    await f.s.boot();
    expect(f.children.map((c) => c.build)).toEqual(["A"]);
    expect(f.restores).toEqual(["saved"]);
  });
  it("backs off after crashes and caps delays", async () => {
    const f = fixture();
    await f.s.boot();
    for (let n = 0; n < 10; n++) {
      f.children.at(-1)!.exit();
      expect(f.timers.size).toBe(1);
      await f.tick(30000);
    }
    expect(f.children).toHaveLength(11);
  });
  it("rolls back a crashing candidate", async () => {
    const f = fixture();
    await f.s.boot();
    await f.s.apply("C", "saved");
    f.children.at(-1)!.exit();
    await f.tick(500);
    expect(f.state().current).toBe("A");
  });
  it("ignores stale confirmations", async () => {
    const f = fixture();
    await f.s.boot();
    await f.s.apply("B", "saved");
    f.children[0]!.message({ type: "confirmed" });
    await f.s.idle();
    expect(f.state().pending).toBeDefined();
  });
  it("rejects same build and overlapping updates", async () => {
    const f = fixture();
    await f.s.boot();
    await expect(f.s.apply("A", "x")).rejects.toMatchObject({
      code: "E_CONFLICT",
    });
    await f.s.apply("B", "x");
    await expect(f.s.apply("C", "x")).rejects.toMatchObject({
      code: "E_CONFLICT",
    });
  });
  it("shutdown cancels every restart/watchdog", async () => {
    const f = fixture();
    await f.s.boot();
    await f.s.apply("B", "saved");
    await f.s.stop();
    await f.tick(999999);
    expect(f.children).toHaveLength(2);
    expect(f.timers.size).toBe(0);
    expect(f.restores).toHaveLength(0);
  });
});
