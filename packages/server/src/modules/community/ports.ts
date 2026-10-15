import type { CommunityAdminDirectory } from "./admin-queries.ts";
import type { CommunityService } from "./service.ts";
export interface CommunityAdmin extends Pick<
  CommunityService,
  "create" | "adminUpdate" | "adminDelete" | "members" | "adminMember"
> {
  adminDirectory: Pick<CommunityAdminDirectory, "group" | "groups">;
}

import type { User } from "@talos/contract";
import type { CommunityRepo } from "./repo.ts";
export type CommunityRead = Pick<
  CommunityService,
  | "canAccess"
  | "canPost"
  | "requireAccess"
  | "conversation"
  | "conversations"
  | "members"
  | "member"
>;
export interface CommunitySyncRead extends Pick<
  CommunityService,
  "canAccess" | "conversations" | "publicMember"
> {
  records: Pick<CommunityRepo, "get" | "member" | "members" | "memberships">;
  user(id: string): User | undefined;
}
