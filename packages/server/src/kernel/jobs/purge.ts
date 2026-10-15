import type { Db } from "../persistence/db.ts";
import type { UserPurgeParticipant } from "../persistence/user-purge.ts";
import { JobRepo } from "./jobs-repo.ts";
export function jobsPurge(db: Db): UserPurgeParticipant {
  const repo = new JobRepo(db);
  return { owner: "jobs", purgeUser: (user) => repo.purgeUser(user) };
}
