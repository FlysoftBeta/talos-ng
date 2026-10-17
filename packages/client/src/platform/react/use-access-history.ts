import { useEffect, useSyncExternalStore } from "react";
import { AccessHistory } from "../../core/ranking/index.ts";
import type { AccessSnapshot } from "../../core/ranking/index.ts";
import type { RuntimePort } from "../../core/runtime-port.ts";
import { useClientSnapshot, useRuntime } from "./context.tsx";

/** The kv key is per user, so each signed-in user gets one shared history per runtime. */
const histories = new WeakMap<
  RuntimePort,
  { user: string; history: AccessHistory }
>();

function historyFor(runtime: RuntimePort, user: string): AccessHistory {
  const known = histories.get(runtime);
  if (known?.user === user) return known.history;
  known?.history.dispose();
  // Never let counters of a previous user reach the next user's kv key.
  const current = (): boolean => runtime.getSnapshot().user?.id === user;
  const history = new AccessHistory({
    getLocal: async (key) => (current() ? runtime.getLocal(key) : undefined),
    setLocal: async (key, value) => {
      if (current()) await runtime.setLocal(key, value);
    },
  });
  histories.set(runtime, { user, history });
  void history.load();
  return history;
}

/** The signed-in user's access history, or undefined while signed out. */
export function useAccessHistory(): AccessHistory | undefined {
  const runtime = useRuntime(),
    user = useClientSnapshot().user?.id;
  return user ? historyFor(runtime, user) : undefined;
}

const none: AccessSnapshot = {};
/** Live counters of the given history (empty while signed out). */
export function useAccessEntries(
  history: AccessHistory | undefined,
): AccessSnapshot {
  return useSyncExternalStore(
    history?.subscribe ?? noSubscribe,
    () => history?.getState().entries ?? none,
  );
}
const noSubscribe = (): (() => void) => () => undefined;

/** Saves pending counters when the page hides or the user changes. */
export function useAccessHistoryFlush(
  history: AccessHistory | undefined,
): void {
  useEffect(() => {
    if (!history) return;
    const hide = (): void => void history.flush();
    window.addEventListener("pagehide", hide);
    return () => {
      window.removeEventListener("pagehide", hide);
      void history.flush();
    };
  }, [history]);
}
