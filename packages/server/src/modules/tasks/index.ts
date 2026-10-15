import type { Jobs, JobTimers } from "../../kernel/jobs/jobs.ts";
import type { SyncHub } from "../../kernel/sync/sync-hub.ts";
import { TasksService, registerDebugSleep } from "./service.ts";
export { TasksService, registerDebugSleep } from "./service.ts";
export { registerTasksApi } from "./api.ts";
export { tasksMigrations } from "./schema.ts";
export { TasksRepo, jobRow } from "./repo.ts";

export interface TasksOptions {
  jobs: Jobs;
  syncHub: SyncHub;
  dev?: boolean;
  timers?: JobTimers;
}
export function createTasks(options: TasksOptions): TasksService {
  const service = new TasksService(options.jobs);
  options.syncHub.registerProvider({
    match: (scope) => scope.startsWith("me:"),
    access: (user, scope) => scope === `me:${user}`,
    list: (user) => [`me:${user}`],
    select: (scope, rev, limit) => service.repo.select(scope, rev, limit),
  });
  options.syncHub.registerEntity("job", {
    serialize: (row) => row,
    read: (scope, id) => service.repo.read(scope, id),
  });
  if (options.dev)
    registerDebugSleep(
      options.jobs,
      options.timers ?? {
        setTimeout: (callback, delay) => setTimeout(callback, delay),
        clearTimeout: (handle) =>
          clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
    );
  return service;
}
