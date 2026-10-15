import type { WriteContext } from "./uow.ts";

/** Owner-local SQL only, on the coordinator's synchronous transaction. */
export interface UserPurgeParticipant {
  readonly owner: string;
  purgeUser(user: string, tx: WriteContext): void;
}
export interface IdentityPurgePort extends UserPurgeParticipant {
  exists(user: string): boolean;
  assertPurgeAllowed(user: string): void;
  prepare(user: string, tx: WriteContext): void;
}
