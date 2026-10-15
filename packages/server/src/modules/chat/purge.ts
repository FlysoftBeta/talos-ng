import type { Db } from "../../kernel/persistence/db.ts";
import type { UserPurgeParticipant } from "../../kernel/persistence/user-purge.ts";
import { ChatPurgeRepo } from "./purge-repo.ts";
export interface PurgePorts {
  deletePost(id: string): unknown;
  removeRefs(kind: string, id: string): void;
}
export function chatPurge(db: Db, ports: PurgePorts): UserPurgeParticipant {
  const repo = new ChatPurgeRepo(db);
  return {
    owner: "chat",
    purgeUser: (user, tx) => repo.purgeUser(user, tx, ports),
  };
}
