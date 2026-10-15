import type { SessionEnvironment } from "../../core/auth/environment.ts";
export const browserSession: SessionEnvironment = {
  get crypto() {
    return globalThis.crypto;
  },
  timers: {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (id) => clearTimeout(id as number),
  },
  online: () => typeof navigator === "undefined" || navigator.onLine !== false,
  persist: () => {
    if (typeof navigator !== "undefined" && navigator.storage?.persist)
      void navigator.storage.persist().catch(() => false);
  },
  activity: (listener) => {
    if (typeof window === "undefined") return () => {};
    const events = ["pointerdown", "touchstart", "keydown", "mousemove"];
    for (const event of events) window.addEventListener(event, listener);
    return () => {
      for (const event of events) window.removeEventListener(event, listener);
    };
  },
};
