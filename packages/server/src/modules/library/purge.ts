import type { Db } from "../../kernel/persistence/db.ts";
import type { WriteContext } from "../../kernel/persistence/uow.ts";
import type { UserPurgeParticipant } from "../../kernel/persistence/user-purge.ts";
import { LibraryPurgeRepo } from "./purge-repo.ts";
export interface PurgePorts {
  deleteDoc(id: string): void;
  deleteCollection(id: string): void;
  removeRefs(kind: string, id: string): void;
  revokeResource(resource: string, tx: WriteContext): void;
}
export function libraryPurge(db: Db, ports: PurgePorts): UserPurgeParticipant {
  const repo = new LibraryPurgeRepo(db);
  return {
    owner: "library",
    purgeUser: (user, tx) => repo.purgeUser(user, tx, ports),
  };
}
