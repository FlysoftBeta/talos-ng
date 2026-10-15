import type { AdminUser, AdminDevice, AdminRole } from "@talos/contract";
import type { Row } from "@talos/sync";
import type { User } from "@talos/contract";
import type { PinRecord } from "./credentials.ts";
export interface UserRecord {
  id: string;
  handle: string;
  name: string;
  roles: string;
  features: string;
  purging: number;
  banned: number;
  banned_until: number | null;
  credential_version: number;
  deleted: number;
  rev: number;
}
export interface DeviceRecord {
  id: string;
  failures: number;
  blocked_until: number;
  bound_user: string | null;
  locked: number;
  banned: number;
  whitelisted: number;
  last_seen: number;
}
export interface SessionRecord {
  hash: string;
  user_id: string;
  device_id: string;
  expires: number;
}

export interface InvitationRecord extends PinRecord {
  id: string;
  expires: number;
  device_id: string | null;
  token_expires: number | null;
}
export interface SessionBinding {
  user?: string;
  device: string;
  tokenHash?: string;
}
export interface IdentitySession {
  user: User;
  token: string;
  expires: number;
  credentialVersion: number;
}
export interface AdminUserStatus {
  banned?: boolean;
  bannedUntil?: number | null;
  deactivated?: boolean;
}

export type IdentityAdminUser = Omit<AdminUser, "mutedUntil">;
export interface IdentityAdminDirectory {
  revokeDeviceSessions(id: string): void;
  revokeInvitation(id: string): boolean;
  updateDevice(device: AdminDevice): void;
  deleteDevice(id: string): boolean;
  whitelistDevice(id: string): void;
  otherStoredRoots(user: string): number;
  activeUserIds(now: number): string[];
  user(id: string): IdentityAdminUser | undefined;
  users(
    query: string,
    offset: number,
    limit: number,
    sort?: "handle" | "created" | "name",
  ): { items: IdentityAdminUser[]; total: number };
  devices(
    query: string,
    offset: number,
    limit: number,
  ): { items: AdminDevice[]; total: number };
  device(id: string): AdminDevice | undefined;
  invitations(
    offset: number,
    limit: number,
  ): {
    items: {
      id: string;
      created: number;
      expires: number;
      claimedBy: string | null;
    }[];
    total: number;
  };
}
export interface IdentityPolicy {
  setPolicy(input: {
    whitelist: boolean;
    systemLock: boolean;
    idleLock: boolean;
    identitySignals: readonly string[];
  }): void;

  policy(): {
    whitelist: number;
    system_lock: number;
    idle_lock: number;
    identity_signals: string;
  };
}
export interface IdentityProfiles {
  active(id: string): boolean;
  profile(id: string): Row | undefined;
}
export interface IdentityAuthors {
  active(id: string): boolean;
  user(id: string): UserRecord | undefined;
}
export interface IdentityAdmin {
  repo: {
    hasHandle(handle: string): boolean;
    user(id: string): UserRecord | undefined;
  };
  directory: IdentityAdminDirectory;
  devices: IdentityPolicy;
  profileCommands: {
    updateProfile(id: string, handle: string, name: string, rev: number): void;
  };
  createUser(input: {
    pin: string;
    name: string;
    handle?: string;
    roles?: readonly AdminRole[];
    preparedPins?: readonly PinRecord[];
  }): User;
  adminResetPin(user: string, pin: string): Promise<void>;
  adminSetStatus(user: string, input: AdminUserStatus): void;
}

export interface IdentityAuthorityDirectory {
  baseActor(id: string): User | undefined;
  activeUserIds(): string[];
  userIdsAfter(cursor: string, limit: number): { id: string }[];
}
export interface IdentityBackupOwner {
  storedRoot(): { id: string } | undefined;
}
