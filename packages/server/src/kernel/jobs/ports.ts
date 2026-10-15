import type { Jobs } from "./jobs.ts";
/** Queries and scheduler-owned transitions run on the caller's existing UoW. */
export type JobCommands = Pick<Jobs, "activeJobs" | "enqueue" | "register">;
