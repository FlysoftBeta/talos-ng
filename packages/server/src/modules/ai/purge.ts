import type { Db } from "../../kernel/persistence/db.ts";
import type { UserPurgeParticipant } from "../../kernel/persistence/user-purge.ts";
import { AiPurgeRepo } from "./purge-repo.ts";
export function aiPurge(db: Db): UserPurgeParticipant {
  const repo = new AiPurgeRepo(db);
  return { owner: "ai", purgeUser: (user) => repo.purgeUser(user) };
}
