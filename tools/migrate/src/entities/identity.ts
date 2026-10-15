import { Db } from "@talos/server/migration";
import { FEATURES } from "@talos/contract";

import type { LegacyRow } from "../types.ts";
import { value, number, time } from "../values.ts";
import { rev, mapId, issue } from "../journal.ts";

export function importIdentity(
  target: Db,
  table: string,
  row: LegacyRow,
  legacyId: string,
): string {
  const id = mapId(target, table, legacyId);
  const r = rev(target);
  const user = (key: string): string => mapId(target, "users", value(row, key));
  const hasUser = (id: string): boolean =>
    !!target.get("SELECT 1 FROM users WHERE id=?", id);
  switch (table) {
    case "users": {
      const handle = value(row, "handle").slice(0, 20) || id.slice(0, 20);
      let unique = handle,
        n = 1;
      while (
        target.get("SELECT 1 FROM users WHERE handle=? COLLATE NOCASE", unique)
      )
        unique = `${handle.slice(0, 15)}_${n++}`;
      if (unique !== handle)
        issue(target, table, id, "duplicate handle renamed to " + unique);
      const roles = target
        .all<{ role: string }>(
          "SELECT role FROM migration_roles WHERE user_id=?",
          legacyId,
        )
        .map((x) => x.role);
      if (roles.length && !roles.includes("administrator"))
        roles.push("administrator");
      const bits = number(row, "feature_bitset");
      const features = FEATURES.filter(
        (_, index) => (bits & (1 << index)) !== 0,
      );
      if (bits >>> FEATURES.length)
        issue(target, table, legacyId, "unknown feature bits omitted");
      const banDeadline = time(row.banned_until);
      const banned = banDeadline > Date.now();
      target.run(
        "INSERT INTO users(id,handle,name,roles,features,banned,banned_until,created,rev,deleted) VALUES(?,?,?,?,?,?,?,?,?,?)",
        id,
        unique,
        value(row, "username").slice(0, 30) || unique,
        JSON.stringify(roles),
        JSON.stringify(features),
        banned ? 1 : 0,
        banned ? banDeadline : null,
        time(row.created_at),
        r,
        0,
      );
      return id;
    }
    case "user_pins":
      if (hasUser(user("user_id")))
        target.run(
          "INSERT OR IGNORE INTO user_pins(hash,user_id,salt,verifier) VALUES(?,?,NULL,NULL)",
          value(row, "pin_hash"),
          user("user_id"),
        );
      break;
    case "user_admin_roles":
      return id;
    case "deleted_users":
      target.run("UPDATE users SET deleted=1,rev=? WHERE id=?", r, user("id"));
      break;
    case "clients":
      target.run(
        "INSERT OR IGNORE INTO devices(id,label,last_seen,whitelisted,bound_user,locked,persistent) VALUES(?,?,?,?,?,?,?)",
        id,
        value(row, "remark"),
        time(row.created_at),
        number(row, "whitelisted"),
        hasUser(user("bound_user_id")) ? user("bound_user_id") : null,
        number(row, "konami_locked"),
        number(row, "persistent"),
      );
      break;
    case "ghost_users":
      target.run(
        "INSERT OR IGNORE INTO invitations(id,created,expires,pin_hash) VALUES(?,?,?,?)",
        id,
        time(row.created_at),
        time(row.oobe_expires),
        value(row, "pin_hash"),
      );
      break;
  }
  return id;
}
