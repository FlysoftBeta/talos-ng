import type { createKernel } from "@talos/server/migration";
import type { LegacyDb } from "../legacy/db.ts";
import { Db } from "@talos/server/migration";
import { AppError } from "@talos/base";

import type { LegacyRow } from "../types.ts";
import { importIdentity } from "./identity.ts";
import { importCommunity } from "./community.ts";
import { importChat } from "./chat.ts";
import { importLibrary } from "./library.ts";
import { importAi } from "./ai.ts";
import { importMedia } from "./media.ts";

export function importRow(
  target: Db,
  table: string,
  row: LegacyRow,
  legacyId: string,
  kernel?: ReturnType<typeof createKernel>,
  source?: LegacyDb,
): string {
  if (
    table === "user_queues" ||
    table.startsWith("media_") ||
    (table === "user_favorites" &&
      ["track", "media_track"].includes(String(row.resource_kind)))
  ) {
    if (!kernel || !source)
      throw new AppError("E_INVALID", "Media import needs kernel/source");
    return importMedia(
      target,
      table === "user_favorites" ? "media_favorite" : table,
      row,
      legacyId,
      kernel,
      source,
    );
  }
  if (
    table === "users" ||
    table === "user_pins" ||
    table === "user_admin_roles" ||
    table === "deleted_users" ||
    table === "clients" ||
    table === "ghost_users"
  )
    return importIdentity(target, table, row, legacyId);
  if (table === "groups" || table === "group_members" || table === "dms")
    return importCommunity(target, table, row, legacyId);
  if (
    table === "posts" ||
    table === "convs_user" ||
    table === "post_images" ||
    table === "post_image_thumbs"
  )
    return importChat(target, table, row, legacyId);
  if (
    table === "articles" ||
    table === "text_article_segments" ||
    table === "booklists" ||
    table === "booklist_items" ||
    table === "group_booklists" ||
    table === "user_favorites" ||
    table === "article_read_progress" ||
    table === "access_bindings" ||
    table === "resource_possession"
  )
    return importLibrary(target, table, row, legacyId, source);
  if (
    table === "ai_conversations" ||
    table === "ai_messages" ||
    table === "ai_credit_accounts" ||
    table === "ai_credit_reservations" ||
    table === "ai_plan_enrollments" ||
    table === "ai_credit_ledger" ||
    table === "ai_workspaces"
  )
    return importAi(target, table, row, legacyId);
  throw new AppError("E_INVALID", `Unsupported entity: ${table}`);
}
