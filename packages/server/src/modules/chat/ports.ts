import type { ChatAdminQueries } from "./admin-queries.ts";
import type { ChatService } from "./service.ts";
export interface ChatAdmin extends Pick<ChatService, "mute" | "publish"> {
  adminQueries: Pick<ChatAdminQueries, "mutes" | "acknowledgementCounts">;
}

import type { CommunityRead } from "../community/ports.ts";
import type { IdentityAuthors } from "../identity/ports.ts";
import type { ChatRepo } from "./repo.ts";
export interface ChatSyncRead {
  repo: Pick<
    ChatRepo,
    | "postRows"
    | "post"
    | "postRow"
    | "ack"
    | "stateRows"
    | "stateRow"
    | "announcementRow"
  >;
  community: Pick<CommunityRead, "canAccess" | "conversations">;
  identity: Pick<IdentityAuthors, "active">;
}
