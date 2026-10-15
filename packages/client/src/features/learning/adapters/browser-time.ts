import type { LearningTime } from "../model/time.ts";

/** Wall-clock timers for the mounted learning feature; tests inject their own `LearningTime`. */
export const browserLearningTime: LearningTime = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as number),
};
