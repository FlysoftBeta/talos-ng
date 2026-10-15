import type { Db } from "../../kernel/persistence/db.ts";
import type { WriteContext } from "../../kernel/persistence/uow.ts";
import type { UserPurgeParticipant } from "../../kernel/persistence/user-purge.ts";
import { AuthorityPurgeRepo } from "./purge-repo.ts";
export interface PurgePorts {
  revokePrincipal(user: string, tx: WriteContext): void;
}
export function authorityPurge(
  db: Db,
  ports: PurgePorts,
): UserPurgeParticipant {
  const repo = new AuthorityPurgeRepo(db);
  return {
    owner: "authority",
    purgeUser: (user, tx) => repo.purgeUser(user, tx, ports),
  };
}
