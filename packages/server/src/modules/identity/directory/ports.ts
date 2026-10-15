import type { User } from "@talos/contract";
import type { Row } from "@talos/sync";

import type { UserRecord } from "../ports.ts";
export interface DirectoryQueries {
  user(id: string): UserRecord | undefined;
  isBanned(row: UserRecord): boolean;
  publicUser(row: UserRecord): User;
  profile(id: string): Row | undefined;
  active(id: string): boolean;
  countUsers(): number;
  hasHandle(handle: string): boolean;
  boundUserExists(id: string): boolean;
}
