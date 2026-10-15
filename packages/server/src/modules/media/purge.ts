import type { Db } from "../../kernel/persistence/db.ts";
import type { WriteContext } from "../../kernel/persistence/uow.ts";
import type { UserPurgeParticipant } from "../../kernel/persistence/user-purge.ts";
import { MediaPurgeRepo } from "./purge-repo.ts";
export interface PurgePorts {
  deletePlaylist(id: string): void;
  revokeResource(resource: string, tx: WriteContext): void;
}
export function mediaPurge(db: Db, ports: PurgePorts): UserPurgeParticipant {
  const repo = new MediaPurgeRepo(db);
  return {
    owner: "media",
    purgeUser: (user, tx) => repo.purgeUser(user, tx, ports),
  };
}
