import { describe, expect, it, vi } from "vitest";
import { AREA_IDS, createNav, isNav, navReducer, restoreNav } from "./nav.ts";
import type { NavIntent, NavPersistence } from "./nav.ts";
import { installBackTrap } from "../../platform/browser/back-trap.ts";

describe("navigation reducer", () => {
  it("starts with independent home stacks for all five areas", () => {
    const a = createNav();
    const b = createNav();
    expect(isNav(a)).toBe(true);
    expect(a).toEqual(b);
    expect(a.areas.chat).not.toBe(b.areas.chat);
    expect(a.areas.chat.stack).not.toBe(a.areas.library.stack);
  });
  it("opens conversations and documents in their own areas without losing other stacks", () => {
    const a = createNav();
    const b = navReducer(a, { type: "openConversation", id: "会话" });
    const c = navReducer(b, { type: "openDocument", id: "文档" });
    expect(c.area).toBe("library");
    expect(c.areas.chat).toBe(b.areas.chat);
    expect(
      navReducer(c, { type: "switchArea", area: "chat" }).areas.chat.stack[1],
    ).toEqual({ kind: "conversation", id: "会话" });
    expect(a.areas.chat.stack).toHaveLength(1);
  });
  it("back closes overlays in LIFO order before popping an area stack", () => {
    let state = navReducer(createNav(), {
      type: "pushPage",
      page: { kind: "page", id: "页面" },
    });
    state = navReducer(state, {
      type: "openOverlay",
      overlay: { kind: "settings" },
    });
    state = navReducer(state, {
      type: "openOverlay",
      overlay: { kind: "status" },
    });
    state = navReducer(state, { type: "back" });
    expect(state.overlays).toEqual([{ kind: "settings" }]);
    state = navReducer(state, { type: "back" });
    expect(state.areas.chat.stack).toHaveLength(2);
    state = navReducer(state, { type: "back" });
    expect(state.areas.chat.stack).toHaveLength(1);
    expect(navReducer(state, { type: "back" })).toBe(state);
  });
  it("keeps lock as a session signal without changing the return destination", () => {
    const state = navReducer(createNav(), {
      type: "openConversation",
      id: "x",
    });
    expect(navReducer(state, { type: "lock" })).toBe(state);
    expect(navReducer(state, { type: "switchArea", area: "chat" })).toBe(state);
    expect(navReducer(state, { type: "closeOverlay" })).toBe(state);
  });
  it("copies pushed page and overlay values", () => {
    const page = { kind: "page" as const, id: "x" };
    const overlay = { kind: "detail" as const, id: "y" };
    const state = navReducer(
      navReducer(createNav(), { type: "pushPage", page }),
      { type: "openOverlay", overlay },
    );
    page.id = "changed";
    overlay.id = "changed";
    expect(state.areas.chat.stack[1]).toEqual({ kind: "page", id: "x" });
    expect(state.overlays[0]).toEqual({ kind: "detail", id: "y" });
  });
  it.each<NavIntent>([
    { type: "openConversation", id: " " },
    { type: "openDocument", id: "" },
    { type: "pushPage", page: { kind: "document", id: "x" }, area: "chat" },
    {
      type: "pushPage",
      page: { kind: "conversation", id: "x" },
      area: "media",
    },
    { type: "openOverlay", overlay: { kind: "detail", id: "" } },
  ])("rejects invalid intent $type", (intent) => {
    expect(() => navReducer(createNav(), intent)).toThrow();
  });
  it.each([
    null,
    [],
    {},
    { ...createNav(), area: "unknown" },
    { ...createNav(), overlays: [{ kind: "detail", id: "" }] },
    { ...createNav(), extra: true },
    { ...createNav(), areas: {} },
  ])("rejects malformed persisted state %j", (state) => {
    expect(isNav(state)).toBe(false);
  });
  it("rejects nonserialisable or extra nested data", () => {
    const state = createNav();
    expect(
      isNav({ ...state, overlays: [{ kind: "status", surprise: () => 1 }] }),
    ).toBe(false);
    expect(
      isNav({ ...state, areas: { ...state.areas, chat: { stack: [] } } }),
    ).toBe(false);
    expect(
      isNav({
        ...state,
        areas: {
          ...state.areas,
          chat: { stack: [{ kind: "home" }, { kind: "document", id: "x" }] },
        },
      }),
    ).toBe(false);
  });
  it("preserves validity and JSON roundtrips for 10,000 seeded intents", () => {
    let state = createNav();
    let seed = 1337;
    for (let index = 0; index < 10_000; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const area = AREA_IDS[seed % AREA_IDS.length]!;
      const intents: NavIntent[] = [
        { type: "switchArea", area },
        { type: "openConversation", id: String(index) },
        { type: "openDocument", id: String(index) },
        { type: "pushPage", area, page: { kind: "page", id: String(index) } },
        { type: "back" },
        { type: "openOverlay", overlay: { kind: "status" } },
        { type: "closeOverlay" },
        { type: "lock" },
      ];
      state = navReducer(state, intents[(seed >>> 16) % intents.length]!);
      expect(isNav(state)).toBe(true);
      if (index % 100 === 0)
        expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    }
  });
});

describe("navigation persistence and browser Back", () => {
  function adapter(value: unknown): NavPersistence {
    return {
      load: vi.fn(async () => value),
      save: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    };
  }
  it("restores user-scoped state and initializes missing state", async () => {
    const stored = navReducer(createNav(), { type: "openDocument", id: "x" });
    const persistence = adapter(stored);
    expect(await restoreNav(persistence, "user-a")).toBe(stored);
    expect(persistence.load).toHaveBeenCalledWith("user-a");
    expect(await restoreNav(adapter(undefined), "user-b")).toEqual(createNav());
  });
  it("reports corrupted state, invalid users and storage failures", async () => {
    await expect(restoreNav(adapter({}), "user")).rejects.toMatchObject({
      code: "E_INTEGRITY",
    });
    await expect(restoreNav(adapter(null), "")).rejects.toMatchObject({
      code: "E_INVALID",
    });
    const persistence = adapter(null);
    persistence.load = vi.fn().mockRejectedValue(new Error("disk"));
    await expect(restoreNav(persistence, "user")).rejects.toMatchObject({
      code: "E_UNAVAILABLE",
    });
  });
  it("rearms history and dispatches lock; cleanup removes only its listener", () => {
    let state: unknown = null;
    let listener: (() => void) | undefined;
    const pushState = vi.fn((value: unknown) => {
      state = value;
    });
    const dispatch = vi.fn();
    const host = {
      history: {
        get state() {
          return state;
        },
        pushState,
      },
      addEventListener: vi.fn((_event: "popstate", callback: () => void) => {
        listener = callback;
      }),
      removeEventListener: vi.fn(),
    };
    const cleanup = installBackTrap(host, dispatch);
    expect(pushState).toHaveBeenCalledTimes(1);
    state = null;
    listener!();
    expect(dispatch).toHaveBeenCalledWith({ type: "lock" });
    expect(pushState).toHaveBeenCalledTimes(2);
    cleanup();
    expect(host.removeEventListener).toHaveBeenCalledWith("popstate", listener);
    installBackTrap(host, dispatch);
    expect(pushState).toHaveBeenCalledTimes(2);
  });
});
