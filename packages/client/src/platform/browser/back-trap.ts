import type { NavIntent } from "../../core/navigation/nav.ts";

export interface BackTrapHost {
  history: Pick<History, "state" | "pushState">;
  addEventListener(type: "popstate", listener: () => void): void;
  removeEventListener(type: "popstate", listener: () => void): void;
}

/** Keeps the URL unchanged. The caller routes lock to its session gate. */
export function installBackTrap(
  host: BackTrapHost,
  dispatch: (intent: NavIntent) => void,
): () => void {
  const marker = "__talosBackSentinel";
  const arm = (): void => {
    const state: unknown = host.history.state;
    if (
      typeof state === "object" &&
      state !== null &&
      (state as Record<string, unknown>)[marker] === true
    )
      return;
    host.history.pushState({ [marker]: true }, "");
  };
  const onBack = (): void => {
    arm();
    dispatch({ type: "lock" });
  };
  arm();
  host.addEventListener("popstate", onBack);
  return () => host.removeEventListener("popstate", onBack);
}
