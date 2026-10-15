import { sourceRows } from "../legacy/readers.ts";
import type { Db, createKernel } from "@talos/server/migration";
import { AppError } from "@talos/base";
import { exists, type LegacyDb } from "../legacy/db.ts";
import { grants, grantPolicy } from "../legacy/access.ts";
import { value } from "../values.ts";
import { issue, mapId, sourceId } from "../journal.ts";
/** D-076/D-090: collections carry authority; possession never manufactures a grant. */
export function importSharing(
  source: LegacyDb,
  target: Db,
  kernel: ReturnType<typeof createKernel>,
): void {
  if (!exists(source, "access_bindings")) return;
  for (let offset = 0; ; offset += 500) {
    const rows = sourceRows(source, "access_bindings", offset);
    if (!rows.length) break;
    kernel.uow.write(() => {
      for (const row of rows) {
        const legacyId = sourceId(row);
        try {
          const kind = value(row, "resource_kind"),
            media = kind === "playlist";
          if (kind === "queue") continue; // Personal queues import via user_queues.
          if (!media && !["booklist", "collection"].includes(kind)) {
            issue(
              target,
              "access_bindings",
              legacyId,
              "Direct article/track bindings excluded: D-076/D-090 require a readable containing collection",
            );
            continue;
          }
          const id = mapId(
            target,
            media ? "media_lists" : "booklists",
            value(row, "resource_id"),
          );
          if (media) kernel.media.playlist(id);
          else kernel.library.collection(id);
          const type = value(row, "principal_kind");
          if (type !== "user" && type !== "group")
            throw new AppError("E_INVALID", "Invalid principal kind");
          const principal = mapId(
            target,
            type === "user" ? "users" : "groups",
            value(row, "principal_id"),
          );
          if (
            !target.get(
              type === "user"
                ? "SELECT 1 FROM users WHERE id=?"
                : "SELECT 1 FROM community_conversations WHERE id=?",
              principal,
            )
          )
            throw new AppError("E_INVALID", "Orphan grant principal");
          const { level, delegable, lossy } = grantPolicy(
            grants(row.grants_json),
          );
          if (lossy)
            issue(
              target,
              "access_bindings",
              legacyId,
              "Read delegation alongside non-delegable write cannot be represented by one delegation bit; retained write with delegation disabled",
            );
          kernel.authority.importGrant({
            id: mapId(target, "access_bindings", legacyId),
            resource: `coll:${id}`,
            principalType: type,
            principal,
            level,
          });
          if (media) kernel.media.repo.delegate(id, type, principal, delegable);
          else kernel.library.repo.delegate(id, type, principal, delegable);
        } catch (error) {
          issue(
            target,
            "access_bindings",
            legacyId,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    });
  }
}
