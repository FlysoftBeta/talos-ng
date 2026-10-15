import type { SessionRecord } from "../ports.ts";
export interface SessionsQueries {
  session(hash: string): SessionRecord | undefined;
  otherSessionCount(device: string, user: string, now: number): number;
  saveSession(
    hash: string,
    user: string,
    device: string,
    now: number,
    expires: number,
  ): void;
  extendSession(hash: string, expires: number): void;
  touchDevice(device: string, now: number): void;
  seenDevice(device: string, now: number): void;
  revoke(hash: string): void;
  revokeOtherSessions(user: string, keepHash?: string): void;
  transaction<T>(run: () => T): T;
}
