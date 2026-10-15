import type { User } from "@talos/contract";

import type { Db } from "../../../kernel/persistence/db.ts";
import type { PinRecord } from "../credentials.ts";
import type { InvitationRecord } from "../ports.ts";
export class ProvisioningRepo {
  constructor(private readonly db: Db) {}
  saveSecret(value: string): void {
    this.db.run("INSERT INTO secrets VALUES('pin_hmac',?)", value);
  }
  pinUser(hash: string): string | undefined {
    return this.db.get<{ user_id: string }>(
      "SELECT user_id FROM user_pins WHERE hash=?",
      hash,
    )?.user_id;
  }
  createUser(user: User, hash: string, now: number, rev: number): void {
    this.db.run(
      "INSERT INTO users(id,handle,name,roles,features,created,rev,credential_version) VALUES(?,?,?,?,?,?,?,?)",
      user.id,
      user.handle,
      user.name,
      JSON.stringify(user.roles),
      JSON.stringify(user.features),
      now,
      rev,
      rev,
    );
    this.db.run(
      "INSERT INTO user_pins(hash,user_id) VALUES(?,?)",
      hash,
      user.id,
    );
  }
  secret(): string | undefined {
    return this.db.get<{ value: string }>(
      "SELECT value FROM secrets WHERE name='pin_hmac'",
    )?.value;
  }
  issueInvitationToken(
    id: string,
    tokenHash: string,
    device: string,
    expires: number,
  ): void {
    this.db.run(
      "UPDATE invitations SET token_hash=?,device_id=?,token_expires=? WHERE id=? AND claimed_by IS NULL",
      tokenHash,
      device,
      expires,
      id,
    );
  }
  insertInvitation(
    id: string,
    now: number,
    expires: number,
    pin: PinRecord,
  ): void {
    this.db.run(
      "UPDATE invitations SET pin_hash=NULL WHERE pin_hash=? AND (expires<=? OR claimed_by IS NOT NULL)",
      pin.hash,
      now,
    );
    this.db.run(
      "INSERT INTO invitations(id,created,expires,pin_hash,salt,verifier) VALUES(?,?,?,?,?,?)",
      id,
      now,
      expires,
      pin.hash,
      pin.salt,
      pin.verifier,
    );
  }
  claimInvitation(id: string, user: string): void {
    this.db.run(
      "UPDATE invitations SET claimed_by=?,token_hash=NULL,pin_hash=NULL WHERE id=?",
      user,
      id,
    );
  }
  setCredentialVersion(user: string, version: number): void {
    this.db.run(
      "UPDATE users SET credential_version=?,rev=? WHERE id=?",
      version,
      version,
      user,
    );
  }
  deletePins(user: string): void {
    this.db.run("DELETE FROM user_pins WHERE user_id=?", user);
  }
  deletePin(hash: string): void {
    this.db.run("DELETE FROM user_pins WHERE hash=?", hash);
  }
  pin(hash: string): (PinRecord & { user_id: string }) | undefined {
    return this.db.get("SELECT * FROM user_pins WHERE hash=?", hash);
  }
  savePin(user: string, pin: PinRecord): void {
    this.db.run(
      "INSERT INTO user_pins(hash,user_id,salt,verifier) VALUES(?,?,?,?) ON CONFLICT(hash) DO UPDATE SET salt=excluded.salt,verifier=excluded.verifier",
      pin.hash,
      user,
      pin.salt,
      pin.verifier,
    );
  }
  invitationPin(hash: string, now: number): InvitationRecord | undefined {
    return this.db.get(
      "SELECT *,pin_hash AS hash FROM invitations WHERE pin_hash=? AND claimed_by IS NULL AND expires>?",
      hash,
      now,
    );
  }
  invitationToken(
    hash: string,
    device: string,
    now: number,
  ): InvitationRecord | undefined {
    return this.db.get(
      "SELECT *,pin_hash AS hash FROM invitations WHERE token_hash=? AND device_id=? AND token_expires>? AND expires>? AND claimed_by IS NULL",
      hash,
      device,
      now,
      now,
    );
  }
  updateProfile(id: string, handle: string, name: string, rev: number): void {
    this.db.run(
      "UPDATE users SET handle=?,name=?,rev=? WHERE id=?",
      handle,
      name,
      rev,
      id,
    );
  }
  transaction<T>(run: () => T): T {
    return this.db.tx(run);
  }

  setStatus(
    user: string,
    banned: number,
    bannedUntil: number | null,
    deleted: number,
    rev: number,
  ): void {
    this.db.run(
      "UPDATE users SET banned=?,banned_until=?,deleted=?,rev=? WHERE id=?",
      banned,
      bannedUntil,
      deleted,
      rev,
      user,
    );
  }
}
