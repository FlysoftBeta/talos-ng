import type { User } from "@talos/contract";
import type { Db } from "../../kernel/persistence/db.ts";
import type { Uow, WriteContext } from "../../kernel/persistence/uow.ts";
export interface CommunityOptions {
  db: Db;
  uow: Uow;
  user(id: string): User | undefined;
  users(): readonly User[];
  now?: () => number;
  id?: () => string;
  onMembershipChanged?(
    user: string,
    conversation: string,
    joined: boolean,
    ctx: WriteContext,
  ): void;
}
