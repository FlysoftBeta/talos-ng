import type { LearningHost } from "../model/controller.ts";

/** Page visibility and unload confirmation for practice sessions. */
export const browserLearningHost: LearningHost = {
  hidden: () => document.hidden,
  onVisibility(listener) {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
  confirmUnload(shouldConfirm) {
    const unload = (event: BeforeUnloadEvent) => {
      if (shouldConfirm()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  },
};
