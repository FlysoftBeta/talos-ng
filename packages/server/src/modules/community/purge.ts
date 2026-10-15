import type { Db } from "../../kernel/persistence/db.ts";
import type { WriteContext } from "../../kernel/persistence/uow.ts";
import type { UserPurgeParticipant } from "../../kernel/persistence/user-purge.ts";
import { CommunityPurgeRepo } from "./purge-repo.ts";
export interface PurgePorts {
  membershipChanged(user: string, conversation: string, tx: WriteContext): void;
}
export function communityPurge(
  db: Db,
  ports: PurgePorts,
): UserPurgeParticipant {
  const repo = new CommunityPurgeRepo(db);
  return {
    owner: "community",
    purgeUser: (user, tx) => repo.purgeUser(user, tx, ports),
  };
}
