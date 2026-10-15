import type { Db } from "../../kernel/persistence/db.ts";
import type { UserPurgeParticipant } from "../../kernel/persistence/user-purge.ts";
import { MePurgeRepo } from "./purge-repo.ts";
export function mePurge(db: Db): UserPurgeParticipant {
  const repo = new MePurgeRepo(db);
  return { owner: "me", purgeUser: (user) => repo.purgeUser(user) };
}
