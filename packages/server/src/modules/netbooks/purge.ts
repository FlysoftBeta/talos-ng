import type { Db } from "../../kernel/persistence/db.ts";
import type { UserPurgeParticipant } from "../../kernel/persistence/user-purge.ts";
import { NetbooksPurgeRepo } from "./purge-repo.ts";
export function netbooksPurge(db: Db): UserPurgeParticipant {
  const repo = new NetbooksPurgeRepo(db);
  return {
    owner: "netbooks",
    purgeUser: (user) => repo.purgeUser(user),
  };
}
