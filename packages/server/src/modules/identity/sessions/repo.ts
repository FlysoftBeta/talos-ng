import type { Db } from "../../../kernel/persistence/db.ts";

import type { SessionRecord } from "../ports.ts";
export class SessionsRepo {
  constructor(private readonly db: Db) {}
  session(hash: string): SessionRecord | undefined {
    return this.db.get<SessionRecord>(
      "SELECT * FROM sessions WHERE hash=?",
      hash,
    );
  }
  otherSessionCount(device: string, user: string, now: number): number {
    return this.db.get<{ count: number }>(
      "SELECT count(*) AS count FROM sessions WHERE device_id=? AND expires>? AND user_id<>?",
      device,
      now,
      user,
    )!.count;
  }
  saveSession(
    hash: string,
    user: string,
    device: string,
    now: number,
    expires: number,
  ): void {
    this.db.run(
      "DELETE FROM sessions WHERE expires<=? OR (user_id=? AND device_id=?)",
      now,
      user,
      device,
    );
    this.db.run(
      "INSERT INTO sessions VALUES(?,?,?,?,?)",
      hash,
      user,
      device,
      now,
      expires,
    );
    this.db.run(
      "UPDATE devices SET failures=0,blocked_until=0,locked=0,last_seen=? WHERE id=?",
      now,
      device,
    );
  }
  extendSession(hash: string, expires: number): void {
    this.db.run("UPDATE sessions SET expires=? WHERE hash=?", expires, hash);
  }
  touchDevice(device: string, now: number): void {
    this.db.run("UPDATE devices SET last_seen=? WHERE id=?", now, device);
  }
  seenDevice(device: string, now: number): void {
    this.db.run(
      "UPDATE devices SET last_seen=?,locked=0 WHERE id=?",
      now,
      device,
    );
  }
  revoke(hash: string): void {
    this.db.run("DELETE FROM sessions WHERE hash=?", hash);
  }
  revokeOtherSessions(user: string, keepHash?: string): void {
    this.db.run(
      "DELETE FROM sessions WHERE user_id=? AND hash<>?",
      user,
      keepHash ?? "",
    );
  }
  transaction<T>(run: () => T): T {
    return this.db.tx(run);
  }
}
