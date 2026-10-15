import { describe, expect, it, vi } from "vitest";
import { NavGuards } from "./guards.ts";
import type { GuardedNavigation } from "./guards.ts";
import type { NavIntent } from "./nav.ts";
describe("generic navigation guards", () => {
  it.each([
    "switchArea",
    "openConversation",
    "openDocument",
    "pushPage",
    "openOverlay",
    "back",
    "closeOverlay",
  ] as const)("defers %s until confirmation", (type) => {
    const guards = new NavGuards(),
      commit = vi.fn();
    let pending: GuardedNavigation | undefined;
    guards.add((request) => {
      pending = request;
      return false;
    });
    const intent: NavIntent =
      type === "switchArea"
        ? { type, area: "chat" as const }
        : type === "openConversation" || type === "openDocument"
          ? { type, id: "x" }
          : type === "pushPage"
            ? { type, page: { kind: "home" as const } }
            : type === "openOverlay"
              ? { type, overlay: { kind: "settings" as const } }
              : { type };
    guards.request(intent, commit);
    expect(commit).not.toHaveBeenCalled();
    pending!.proceed();
    pending!.proceed();
    expect(commit).toHaveBeenCalledOnce();
  });
  it("cancels and fences stale confirmation callbacks without bypassing later guards", () => {
    const guards = new NavGuards(),
      commit = vi.fn();
    const pending: GuardedNavigation[] = [];
    guards.add((request) => {
      pending.push(request);
      return false;
    });
    guards.request({ type: "back" }, commit);
    guards.request({ type: "back" }, commit);
    pending[0]!.proceed();
    expect(commit).not.toHaveBeenCalled();
    pending[1]!.cancel();
    pending[1]!.proceed();
    expect(commit).not.toHaveBeenCalled();
  });
  it("conceals immediately while notifying guards to retain their interrupted work", () => {
    const guards = new NavGuards(),
      guard = vi.fn(() => false);
    const off = guards.add(guard);
    guards.conceal();
    expect(guard).toHaveBeenCalledWith(
      expect.objectContaining({ intent: { type: "lock" } }),
    );
    off();
    const commit = vi.fn();
    guards.request({ type: "back" }, commit);
    expect(commit).toHaveBeenCalledOnce();
  });
});
