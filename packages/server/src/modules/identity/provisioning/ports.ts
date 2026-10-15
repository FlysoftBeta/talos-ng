import type { User } from "@talos/contract";

import type { PinRecord } from "../credentials.ts";
import type { InvitationRecord } from "../ports.ts";
export interface ProvisioningQueries {
  saveSecret(value: string): void;
  pinUser(hash: string): string | undefined;
  createUser(user: User, hash: string, now: number, rev: number): void;
  secret(): string | undefined;
  issueInvitationToken(
    id: string,
    tokenHash: string,
    device: string,
    expires: number,
  ): void;
  insertInvitation(
    id: string,
    now: number,
    expires: number,
    pin: PinRecord,
  ): void;
  claimInvitation(id: string, user: string): void;
  setCredentialVersion(user: string, version: number): void;
  deletePins(user: string): void;
  deletePin(hash: string): void;
  pin(hash: string): (PinRecord & { user_id: string }) | undefined;
  savePin(user: string, pin: PinRecord): void;
  invitationPin(hash: string, now: number): InvitationRecord | undefined;
  invitationToken(
    hash: string,
    device: string,
    now: number,
  ): InvitationRecord | undefined;
  updateProfile(id: string, handle: string, name: string, rev: number): void;
  transaction<T>(run: () => T): T;
  setStatus(
    user: string,
    banned: number,
    bannedUntil: number | null,
    deleted: number,
    rev: number,
  ): void;
}
