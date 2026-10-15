import { AppError } from "@talos/base";
import { Db } from "@talos/server/migration";

import type { LegacyRow } from "../types.ts";
import { value, number, time } from "../values.ts";
import { rev, mapId } from "../journal.ts";

export function importCommunity(
  target: Db,
  table: string,
  row: LegacyRow,
  legacyId: string,
): string {
  const id = mapId(target, table, legacyId);
  const r = rev(target);
  const user = (key: string): string => mapId(target, "users", value(row, key));
  const group = (key: string): string =>
    mapId(target, "groups", value(row, key));
  const hasUser = (id: string): boolean =>
    !!target.get("SELECT 1 FROM users WHERE id=?", id);
  switch (table) {
    case "groups": {
      const type = value(row, "type");
      const conv = id;
      if (type === "wild" || type === "announcement") {
        const existing = target.get<{ id: string }>(
          "SELECT id FROM community_conversations WHERE type=? AND deleted=0",
          type,
        );
        if (existing) {
          target.run(
            "UPDATE community_conversations SET name=?,created=?,rev=? WHERE id=?",
            value(row, "name"),
            time(row.created_at),
            r,
            existing.id,
          );
          return existing.id;
        }
      }
      let handle = value(row, "handle") || id;
      let n = 1;
      while (
        target.get(
          "SELECT 1 FROM community_conversations WHERE handle=? COLLATE NOCASE",
          handle,
        )
      )
        handle = `${value(row, "handle")}_${n++}`;
      target.run(
        "INSERT INTO community_conversations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        conv,
        "group",
        type === "wild" || type === "announcement" ? type : "normal",
        value(row, "name"),
        handle,
        null,
        null,
        number(row, "discoverable"),
        number(row, "members_hidden"),
        number(row, "admin_only"),
        number(row, "no_leave"),
        row.password_hash ?? null,
        null,
        time(row.created_at),
        r,
        0,
      );
      if (value(row, "parent_group_id"))
        target.run(
          "INSERT INTO migration_parents(child,parent) VALUES(?,?)",
          conv,
          value(row, "parent_group_id"),
        );
      return conv;
    }
    case "group_members": {
      const g = group("group_id"),
        u = user("user_id");
      if (
        !hasUser(u) ||
        !target.get("SELECT 1 FROM community_conversations WHERE id=?", g)
      )
        throw new AppError("E_INVALID", "orphan membership");
      target.run(
        "INSERT OR IGNORE INTO community_members VALUES(?,?,?,?,?,0)",
        g,
        u,
        number(row, "hide_self"),
        time(row.joined_at),
        r,
      );
      break;
    }
    case "dms": {
      const a = user("peer_a"),
        b = user("peer_b");
      if (!hasUser(a) || !hasUser(b))
        throw new AppError("E_INVALID", "orphan dm");
      target.run(
        "INSERT INTO community_conversations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id,
        "dm",
        "normal",
        "",
        id,
        null,
        null,
        0,
        0,
        0,
        0,
        null,
        [a, b].sort().join(":"),
        time(row.created_at),
        r,
        0,
      );
      break;
    }
  }
  return id;
}
