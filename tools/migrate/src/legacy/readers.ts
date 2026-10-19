import { AppError } from "@talos/base";
import type { LegacyRow } from "../types.ts";
import type { LegacyDb } from "./db.ts";
import { identityTables, readIdentity } from "./identity.ts";
import { communityTables, readCommunity } from "./community.ts";
import { chatTables, readChat } from "./chat.ts";
import { libraryTables, readLibrary } from "./library.ts";
import { mediaTables, readMedia } from "./media.ts";
import { aiTables, readAi } from "./ai.ts";
export const tables = [
  "users",
  "user_pins",
  "user_admin_roles",
  "deleted_users",
  "clients",
  "ghost_users",
  "groups",
  "group_members",
  "dms",
  "posts",
  "convs_user",
  "articles",
  "text_article_segments",
  "booklists",
  "booklist_items",
  "group_booklists",
  "access_bindings",
  "resource_possession",
  "media_tracks",
  "media_assets",
  "media_lists",
  "media_list_items",
  "user_queues",
  "user_favorites",
  "article_read_progress",
  "ai_conversations",
  "ai_messages",
  "ai_credit_accounts",
  "ai_plan_enrollments",
  "ai_credit_reservations",
  "ai_credit_ledger",
  "ai_workspaces",
  "post_images",
  "post_image_thumbs",
] as const;

export function sourceRows(
  db: LegacyDb,
  table: string,
  offset: number,
): LegacyRow[] {
  if ((identityTables as readonly string[]).includes(table))
    return readIdentity(db, table, offset);
  if ((communityTables as readonly string[]).includes(table))
    return readCommunity(db, table, offset);
  if ((chatTables as readonly string[]).includes(table))
    return readChat(db, table, offset);
  if ((libraryTables as readonly string[]).includes(table))
    return readLibrary(db, table, offset);
  if ((mediaTables as readonly string[]).includes(table))
    return readMedia(db, table, offset);
  if ((aiTables as readonly string[]).includes(table))
    return readAi(db, table, offset);
  throw new AppError("E_INVALID", `Unknown legacy entity: ${table}`);
}
