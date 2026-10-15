import { AppError } from "@talos/base";
import type { User } from "@talos/contract";
import type { Row } from "@talos/sync";
import type { Db } from "../../../kernel/persistence/db.ts";

import type { UserRecord } from "../ports.ts";
export class DirectoryRepo {
  constructor(
    private readonly db: Db,
    private readonly access?: (user: User) => User,
    private readonly accessRevision?: (user: string) => number,
    private readonly now: () => number = Date.now,
  ) {}
  user(id: string): UserRecord | undefined {
    const row = this.db.get<UserRecord>("SELECT * FROM users WHERE id=?", id);
    if (row && !this.isBanned(row)) {
      row.banned = 0;
      row.banned_until = null;
    }
    return row;
  }
  isBanned(row: UserRecord): boolean {
    return (
      !!row.banned &&
      (row.banned_until === null || row.banned_until > this.now())
    );
  }
  publicUser(row: UserRecord): User {
    const user: User = {
      id: row.id,
      handle: row.handle,
      name: row.name,
      roles: JSON.parse(row.roles) as User["roles"],
      features: JSON.parse(row.features) as User["features"],
      credentialVersion: row.credential_version,
      bannedUntil: this.isBanned(row) ? row.banned_until : null,
    };
    return this.access?.(user) ?? user;
  }
  profile(id: string): Row | undefined {
    const row = this.user(id);
    return row
      ? {
          type: "profile",
          id,
          rev: Math.max(row.rev, this.accessRevision?.(id) ?? 0),
          deleted: row.deleted === 1,
          data: row.deleted ? null : this.publicUser(row),
        }
      : undefined;
  }
  active(id: string): boolean {
    const user = this.user(id);
    return !!user && !user.deleted && !user.banned && !user.purging;
  }
  assertWritable(id: string): void {
    const user = this.user(id);
    if (!user || user.deleted || user.purging)
      throw new AppError("E_DENIED", "用户不可用或正在清除");
  }
  countUsers(): number {
    return this.db.get<{ count: number }>(
      "SELECT count(*) AS count FROM users",
    )!.count;
  }
  hasHandle(handle: string): boolean {
    return !!this.db.get(
      "SELECT 1 FROM users WHERE handle=? COLLATE NOCASE",
      handle,
    );
  }
  boundUserExists(id: string): boolean {
    const row = this.user(id);
    return !!row && !row.deleted;
  }
  initialized(): boolean {
    return !!this.db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
    );
  }
  baseActor(id: string): User | undefined {
    const row = this.db.get<{
      id: string;
      handle: string;
      name: string;
      roles: string;
      features: string;
    }>(
      "SELECT * FROM users WHERE id=? AND purging=0 AND (banned=0 OR banned_until<=?) AND deleted=0",
      id,
      this.now(),
    );
    return row
      ? {
          ...row,
          roles: JSON.parse(row.roles) as User["roles"],
          features: JSON.parse(row.features) as User["features"],
        }
      : undefined;
  }

  activeUserIds(): string[] {
    return this.db
      .all<{ id: string }>(
        "SELECT id FROM users WHERE deleted=0 AND purging=0 AND (banned=0 OR banned_until<=?)",
        this.now(),
      )
      .map((row) => row.id);
  }
  userIdsAfter(cursor: string, limit: number): { id: string }[] {
    return this.db.all<{ id: string }>(
      "SELECT id FROM users WHERE id>? ORDER BY id LIMIT ?",
      cursor,
      limit,
    );
  }
  /** Daily backups retain the existing stored-role, unbanned-user selection. */
  storedRoot(): { id: string } | undefined {
    return this.db.get<{ id: string }>(
      "SELECT id FROM users WHERE deleted=0 AND purging=0 AND banned=0 AND EXISTS(SELECT 1 FROM json_each(roles) WHERE value='root') LIMIT 1",
    );
  }
}
