import type { AdminDevice } from "@talos/contract";
import type { Db } from "../../../kernel/persistence/db.ts";
import type { UserRecord, IdentityAdminUser } from "../ports.ts";
import type { DirectoryQueries } from "./ports.ts";
interface UserRow extends UserRecord {
  created: number;
}
interface DeviceRow {
  id: string;
  label: string;
  last_seen: number;
  whitelisted: number;
  locked: number;
  bound_user: string | null;
  persistent: number;
}
interface InvitationRow {
  id: string;
  created: number;
  expires: number;
  claimed_by: string | null;
}
export class AdminDirectory {
  constructor(
    private readonly db: Db,
    private readonly identity: DirectoryQueries,
  ) {}
  user(id: string): IdentityAdminUser | undefined {
    const row = this.db.get<UserRow>(
      "SELECT u.* FROM users u WHERE u.id=?",
      id,
    );
    return row ? this.mapUser(row) : undefined;
  }
  users(
    query: string,
    offset: number,
    limit: number,
    sort: "handle" | "created" | "name" = "handle",
  ): { items: IdentityAdminUser[]; total: number } {
    const q = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const where =
      "WHERE u.handle LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\'";
    const total = this.db.get<{ n: number }>(
      `SELECT count(*) AS n FROM users u ${where}`,
      q,
      q,
    )!.n;
    const order =
      sort === "created"
        ? "u.created DESC,u.id"
        : sort === "name"
          ? "u.name COLLATE NOCASE,u.id"
          : "u.handle COLLATE NOCASE,u.id";
    const rows = this.db.all<UserRow>(
      `SELECT u.* FROM users u ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      q,
      q,
      limit,
      offset,
    );
    return { items: rows.map((row) => this.mapUser(row)), total };
  }
  devices(
    query: string,
    offset: number,
    limit: number,
  ): { items: AdminDevice[]; total: number } {
    const q = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const where = "WHERE id LIKE ? ESCAPE '\\' OR label LIKE ? ESCAPE '\\'";
    const total = this.db.get<{ n: number }>(
      `SELECT count(*) AS n FROM devices ${where}`,
      q,
      q,
    )!.n;
    const rows = this.db.all<DeviceRow>(
      `SELECT id,label,last_seen,whitelisted,locked,bound_user,persistent FROM devices ${where} ORDER BY last_seen DESC,id LIMIT ? OFFSET ?`,
      q,
      q,
      limit,
      offset,
    );
    return { items: rows.map(this.mapDevice), total };
  }
  device(id: string): AdminDevice | undefined {
    const row = this.db.get<DeviceRow>(
      "SELECT id,label,last_seen,whitelisted,locked,bound_user,persistent FROM devices WHERE id=?",
      id,
    );
    return row && this.mapDevice(row);
  }
  invitations(
    offset: number,
    limit: number,
  ): {
    items: {
      id: string;
      created: number;
      expires: number;
      claimedBy: string | null;
    }[];
    total: number;
  } {
    const total = this.db.get<{ n: number }>(
      "SELECT count(*) AS n FROM invitations",
    )!.n;
    const rows = this.db.all<InvitationRow>(
      "SELECT id,created,expires,claimed_by FROM invitations ORDER BY created DESC,id DESC LIMIT ? OFFSET ?",
      limit,
      offset,
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        created: r.created,
        expires: r.expires,
        claimedBy: r.claimed_by,
      })),
      total,
    };
  }
  private mapUser(row: UserRow): IdentityAdminUser {
    const access = this.identity.publicUser(row);
    return {
      id: row.id,
      handle: row.handle,
      name: row.name,
      roles: access.roles,
      features: access.features,
      banned: this.identity.isBanned(row),
      bannedUntil: this.identity.isBanned(row) ? row.banned_until : null,
      deactivated: !!row.deleted || !!row.purging,
      created: row.created,
    };
  }
  private mapDevice(row: DeviceRow): AdminDevice {
    return {
      id: row.id,
      label: row.label,
      lastSeen: row.last_seen,
      whitelisted: !!row.whitelisted,
      locked: !!row.locked,
      boundUser: row.bound_user,
      persistent: !!row.persistent,
    };
  }

  revokeDeviceSessions(id: string): void {
    this.db.run("DELETE FROM sessions WHERE device_id=?", id);
  }
  revokeInvitation(id: string): boolean {
    return !!this.db.run(
      "DELETE FROM invitations WHERE id=? AND claimed_by IS NULL",
      id,
    ).changes;
  }
  updateDevice(device: AdminDevice): void {
    this.db.run(
      "UPDATE devices SET label=?,bound_user=?,whitelisted=?,locked=?,persistent=? WHERE id=?",
      device.label,
      device.boundUser,
      Number(device.whitelisted),
      Number(device.locked),
      Number(device.persistent),
      device.id,
    );
  }
  deleteDevice(id: string): boolean {
    return !!this.db.run("DELETE FROM devices WHERE id=?", id).changes;
  }
  whitelistDevice(id: string): void {
    this.db.run("UPDATE devices SET whitelisted=1 WHERE id=?", id);
  }
  otherStoredRoots(user: string): number {
    return this.db.get<{ n: number }>(
      "SELECT count(*) AS n FROM users WHERE deleted=0 AND id<>? AND roles LIKE '%root%'",
      user,
    )!.n;
  }
  activeUserIds(now: number): string[] {
    return this.db
      .all<{ id: string }>(
        "SELECT id FROM users WHERE deleted=0 AND (banned=0 OR banned_until<=?)",
        now,
      )
      .map((row) => row.id);
  }
}
