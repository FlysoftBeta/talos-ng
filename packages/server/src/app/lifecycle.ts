import { chatMaintenance } from "../modules/chat/maintenance.ts";
import { aiMaintenance } from "../modules/ai/maintenance.ts";
import { adminMaintenance } from "../modules/admin/maintenance.ts";
import type { Kernel } from "./create-application.ts";
export function applicationLifecycle(
  {
    jobs,
    ops,
    host,
    tickets,
    db,
    uploads,
    media,
    admin,
    objects,
    ai,
    syncHub,
  }: Pick<
    Kernel,
    | "jobs"
    | "ops"
    | "host"
    | "tickets"
    | "db"
    | "uploads"
    | "media"
    | "admin"
    | "objects"
    | "ai"
    | "syncHub"
  >,
  now: () => number,
  backgroundTasks = true,
): Pick<Kernel, "maintain" | "close"> {
  if (backgroundTasks !== false) {
    jobs.start();
    ops.start();
  }
  const stagingHooks = [
    chatMaintenance(db),
    aiMaintenance(db),
    adminMaintenance(db),
  ];
  const sweepStaging = (now: number): void => {
    db.tx(() => {
      for (const maintain of stagingHooks) maintain(now, 86_400_000);
    });
  };
  let closed = false;
  let maintenance: Promise<void> | undefined;
  return {
    maintain(): Promise<void> {
      if (closed) return Promise.resolve();
      if (!maintenance)
        maintenance = (async () => {
          host.sweepOps();
          tickets.sweep();
          sweepStaging(now());
          await ops.maintain();
          await uploads.sweep();
          media.evict(admin.settings().evictionDays);
          await objects.sweep();
        })().finally(() => {
          maintenance = undefined;
        });
      return maintenance;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await host.drain();
      host.close();
      ai.close();
      jobs.close();
      await ops.close();
      syncHub.clear();
      await maintenance;
    },
  };
}
