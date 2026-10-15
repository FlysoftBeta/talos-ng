import type { PageVisibility } from "../model/reading-session.ts";

/** Page visibility from the browser document. */
export const documentVisibility: PageVisibility = {
  hidden: () => document.hidden,
  subscribe: (listener) => {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};
