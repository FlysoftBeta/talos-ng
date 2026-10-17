import { AppError, isAppError } from "@talos/base";

export const AREA_IDS = [
  "chat",
  "recent",
  "library",
  "learning",
  "media",
  "ai",
] as const;
export type AreaId = (typeof AREA_IDS)[number];
export type Page =
  | { kind: "home" }
  | { kind: "conversation"; id: string }
  | { kind: "document"; id: string }
  | { kind: "page"; id: string };
export interface AreaState {
  stack: readonly Page[];
}
export type Overlay =
  { kind: "status" | "settings" | "admin" } | { kind: "detail"; id: string };
export interface Nav {
  area: AreaId;
  areas: Record<AreaId, AreaState>;
  overlays: readonly Overlay[];
}
export type NavIntent =
  | { type: "switchArea"; area: AreaId }
  | { type: "openConversation"; id: string }
  | { type: "openDocument"; id: string }
  | { type: "pushPage"; page: Page; area?: AreaId }
  | { type: "openOverlay"; overlay: Overlay }
  | { type: "closeOverlay" }
  | { type: "back" }
  | { type: "lock" };

export function createNav(): Nav {
  return {
    area: "chat",
    areas: {
      chat: { stack: [{ kind: "home" }] },
      recent: { stack: [{ kind: "home" }] },
      library: { stack: [{ kind: "home" }] },
      learning: { stack: [{ kind: "home" }] },
      media: { stack: [{ kind: "home" }] },
      ai: { stack: [{ kind: "home" }] },
    },
    overlays: [],
  };
}

function push(state: Nav, area: AreaId, page: Page): Nav {
  if ("id" in page && !page.id.trim())
    throw new AppError("E_INVALID", "页面标识不能为空");
  if (
    (page.kind === "conversation" && area !== "chat") ||
    (page.kind === "document" && area !== "library")
  )
    throw new AppError("E_INVALID", "页面与区域不匹配");
  return {
    ...state,
    area,
    areas: {
      ...state.areas,
      [area]: { stack: [...state.areas[area].stack, { ...page }] },
    },
  };
}

/** Gates (including lock) are session state; this reducer owns navigation only. */
export function navReducer(state: Nav, intent: NavIntent): Nav {
  switch (intent.type) {
    case "switchArea":
      return state.area === intent.area
        ? state
        : { ...state, area: intent.area };
    case "openConversation":
      return push(state, "chat", { kind: "conversation", id: intent.id });
    case "openDocument":
      return push(state, "library", { kind: "document", id: intent.id });
    case "pushPage":
      return push(state, intent.area ?? state.area, intent.page);
    case "openOverlay":
      if (intent.overlay.kind === "detail" && !intent.overlay.id.trim())
        throw new AppError("E_INVALID", "浮层标识不能为空");
      return { ...state, overlays: [...state.overlays, { ...intent.overlay }] };
    case "closeOverlay":
      return state.overlays.length
        ? { ...state, overlays: state.overlays.slice(0, -1) }
        : state;
    case "back": {
      if (state.overlays.length)
        return navReducer(state, { type: "closeOverlay" });
      const stack = state.areas[state.area].stack;
      return stack.length > 1
        ? {
            ...state,
            areas: {
              ...state.areas,
              [state.area]: { stack: stack.slice(0, -1) },
            },
          }
        : state;
    }
    case "lock":
      return state;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function page(value: unknown, area: AreaId): value is Page {
  if (!record(value)) return false;
  if (value.kind === "home") return Object.keys(value).length === 1;
  return (
    (value.kind === "page" ||
      (value.kind === "conversation" && area === "chat") ||
      (value.kind === "document" && area === "library")) &&
    typeof value.id === "string" &&
    !!value.id.trim() &&
    Object.keys(value).length === 2
  );
}
export function isNav(value: unknown): value is Nav {
  if (
    !record(value) ||
    Object.keys(value).length !== 3 ||
    !AREA_IDS.includes(value.area as AreaId) ||
    !record(value.areas) ||
    !Array.isArray(value.overlays)
  )
    return false;
  if (Object.keys(value.areas).length !== AREA_IDS.length) return false;
  for (const area of AREA_IDS) {
    const state = value.areas[area];
    if (
      !record(state) ||
      Object.keys(state).length !== 1 ||
      !Array.isArray(state.stack) ||
      !state.stack.length ||
      !state.stack.every((item) => page(item, area)) ||
      state.stack[0]?.kind !== "home"
    )
      return false;
  }
  return value.overlays.every(
    (item) =>
      record(item) &&
      ((["status", "settings", "admin"].includes(item.kind as string) &&
        Object.keys(item).length === 1) ||
        (item.kind === "detail" &&
          typeof item.id === "string" &&
          !!item.id.trim() &&
          Object.keys(item).length === 2)),
  );
}

/** Implement with the per-user IndexedDB repository; no browser storage is touched here. */
export interface NavPersistence {
  load(userId: string): Promise<unknown>;
  save(userId: string, state: Nav): Promise<void>;
  remove(userId: string): Promise<void>;
}
export async function restoreNav(
  adapter: NavPersistence,
  userId: string,
): Promise<Nav> {
  if (!userId.trim()) throw new AppError("E_INVALID", "用户标识不能为空");
  let value: unknown;
  try {
    value = await adapter.load(userId);
  } catch (error) {
    if (isAppError(error)) throw error;
    throw new AppError("E_UNAVAILABLE", "无法读取导航状态");
  }
  if (value === undefined || value === null) return createNav();
  if (!isNav(value)) throw new AppError("E_INTEGRITY", "保存的导航状态无效");
  return value;
}
