import type { Db } from "../../kernel/persistence/db.ts";
import type { UserPurgeParticipant } from "../../kernel/persistence/user-purge.ts";
import { LearningPurgeRepo } from "./purge-repo.ts";
export function learningPurge(db: Db): UserPurgeParticipant {
  const repo = new LearningPurgeRepo(db);
  return {
    owner: "learning",
    purgeUser: (user) => repo.purgeUser(user),
  };
}
