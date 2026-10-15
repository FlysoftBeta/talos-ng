import type { Db } from "@talos/server/migration";
import { AppError } from "@talos/base";
import { exists, type LegacyDb } from "./db.ts";
import { mapId, issue } from "../journal.ts";
import { json } from "../values.ts";
export interface LegacyGrant {
  mode: "owner" | "readwrite" | "read";
  shareable?: boolean;
}
export function grants(raw: unknown): LegacyGrant[] {
  const parsed = json(raw, []);
  if (!Array.isArray(parsed))
    throw new AppError("E_INVALID", "Invalid legacy grants");
  return parsed.map((g: unknown) => {
    if (
      !g ||
      typeof g !== "object" ||
      !("mode" in g) ||
      !["owner", "readwrite", "read"].includes(String(g.mode))
    )
      throw new AppError("E_INVALID", "Invalid legacy grant mode");
    if (
      g.mode !== "owner" &&
      (!("shareable" in g) || typeof g.shareable !== "boolean")
    )
      throw new AppError("E_INVALID", "Invalid legacy shareable flag");
    return g as LegacyGrant;
  });
}
export function owner(
  source: LegacyDb,
  target: Db,
  kind: string,
  id: string,
): string {
  if (exists(source, "access_bindings")) {
    let cursor = 0;
    for (;;) {
      const rows = source.all<{
        rowid: number;
        principal_id: string;
        grants_json: string;
      }>(
        "SELECT rowid,principal_id,grants_json FROM access_bindings WHERE resource_kind=? AND resource_id=? AND principal_kind='user' AND rowid>? ORDER BY rowid LIMIT 500",
        kind,
        id,
        cursor,
      );
      if (!rows.length) break;
      for (const row of rows) {
        cursor = row.rowid;
        if (grants(row.grants_json).some((g) => g.mode === "owner")) {
          const user = mapId(target, "users", row.principal_id);
          if (target.get("SELECT 1 FROM users WHERE id=?", user)) return user;
        }
      }
    }
  }
  const fallback = target.get<{ id: string }>(
    "SELECT id FROM users WHERE deleted=0 ORDER BY created,id LIMIT 1",
  )?.id;
  if (!fallback) throw new AppError("E_INVALID", "No imported owner available");
  issue(
    target,
    kind,
    id,
    "No direct legacy user owner; assigned earliest imported user (group ownership remains a grant)",
  );
  return fallback;
}

export interface GrantPolicy {
  level: "read" | "write" | "own";
  delegable: boolean;
  lossy: boolean;
}
/** Keep the strongest access, never expand the shareable portion of a legacy path. */
export function grantPolicy(set: readonly LegacyGrant[]): GrantPolicy {
  if (!set.length) throw new AppError("E_INVALID", "Empty legacy grant set");
  const level = set.some((g) => g.mode === "owner")
    ? "own"
    : set.some((g) => g.mode === "readwrite")
      ? "write"
      : "read";
  const delegable = set.some(
    (g) =>
      g.mode === "owner" ||
      (g.shareable && (level === "read" || g.mode === "readwrite")),
  );
  return {
    level,
    delegable,
    lossy:
      level === "write" &&
      !delegable &&
      set.some((g) => g.mode === "read" && g.shareable),
  };
}
