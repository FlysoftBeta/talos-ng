import type { IdentityAuthorityDirectory } from "../identity/ports.ts";
import type { User } from "@talos/contract";
import type { Db } from "../../kernel/persistence/db.ts";
export interface Grant {
  id: string;
  resource: string;
  principal_type: "user" | "group";
  principal: string;
  level: "read" | "write" | "own";
  rev: number;
  deleted: number;
}
export class AuthorityRepo {
  constructor(
    private readonly db: Db,
    private readonly identity: IdentityAuthorityDirectory,
  ) {}
  project(user: User): User {
    const row = this.db.get<{ roles: string; features: string }>(
      "SELECT roles,features FROM authority_access WHERE user_id=? AND deleted=0",
      user.id,
    );
    return row
      ? {
          ...user,
          roles: JSON.parse(row.roles) as User["roles"],
          features: JSON.parse(row.features) as User["features"],
        }
      : user;
  }
  actor(id: string): User | undefined {
    const user = this.identity.baseActor(id);
    return user ? this.project(user) : undefined;
  }
  setAccess(user: User, rev: number): void {
    this.db.run(
      "INSERT INTO authority_access(user_id,roles,features,rev) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET roles=excluded.roles,features=excluded.features,rev=excluded.rev",
      user.id,
      JSON.stringify(user.roles),
      JSON.stringify(user.features),
      rev,
    );
  }
  revision(user: string): number {
    return (
      this.db.get<{ rev: number }>(
        "SELECT rev FROM authority_access WHERE user_id=?",
        user,
      )?.rev ?? 0
    );
  }
  roots(): number {
    // Root protection uses effective authority roles and current identity admission.
    return this.identity
      .activeUserIds()
      .filter((id) => this.actor(id)?.roles.includes("root")).length;
  }
  /** Live resources with the prefix granted to the user directly or to one of `groups`. */
  grantedResources(
    user: string,
    groups: readonly string[],
    prefix: string,
  ): string[] {
    return this.db
      .all<{ resource: string }>(
        `SELECT DISTINCT resource FROM authority_grants
         WHERE deleted=0 AND substr(resource,1,length(?))=?
           AND ((principal_type='user' AND principal=?)
             OR (principal_type='group' AND principal IN (SELECT value FROM json_each(?))))`,
        prefix,
        prefix,
        user,
        JSON.stringify(groups),
      )
      .map((row) => row.resource);
  }
  /** Grants (live or deleted) addressed to `user` or `groups`, or projected for `user`. */
  grantsFor(user: string, groups: readonly string[]): Grant[] {
    return this.db.all(
      `SELECT * FROM authority_grants
       WHERE (principal_type='user' AND principal=?)
          OR (principal_type='group' AND principal IN (SELECT value FROM json_each(?)))
          OR id IN (SELECT grant_id FROM authority_grant_projections WHERE user_id=?)`,
      user,
      JSON.stringify(groups),
      user,
    );
  }
  projections(
    user: string,
  ): { grant_id: string; rev: number; deleted: number }[] {
    return this.db.all(
      "SELECT grant_id,rev,deleted FROM authority_grant_projections WHERE user_id=?",
      user,
    );
  }
  /** The grant row (live or deleted) for one resource/principal pair. */
  grantFor(
    resource: string,
    principalType: string,
    principal: string,
  ): Grant | undefined {
    return this.db.get(
      "SELECT * FROM authority_grants WHERE resource=? AND principal_type=? AND principal=?",
      resource,
      principalType,
      principal,
    );
  }
  /** Grants (live or deleted) addressed to one principal. */
  grantsTo(principalType: string, principal: string): Grant[] {
    return this.db.all(
      "SELECT * FROM authority_grants WHERE principal=? AND principal_type=? ORDER BY rev,id",
      principal,
      principalType,
    );
  }
  grants(resource: string): Grant[] {
    return this.db.all(
      "SELECT * FROM authority_grants WHERE resource=? AND deleted=0",
      resource,
    );
  }
  projection(
    user: string,
    grant: string,
  ): { rev: number; deleted: number } | undefined {
    return this.db.get(
      "SELECT rev,deleted FROM authority_grant_projections WHERE user_id=? AND grant_id=?",
      user,
      grant,
    );
  }
  projectGrant(
    user: string,
    grant: string,
    rev: number,
    deleted: boolean,
  ): void {
    this.db.run(
      "INSERT INTO authority_grant_projections VALUES(?,?,?,?) ON CONFLICT(user_id,grant_id) DO UPDATE SET rev=excluded.rev,deleted=excluded.deleted",
      user,
      grant,
      rev,
      deleted ? 1 : 0,
    );
  }
  revokeMatching(
    field: "resource" | "principal",
    value: string,
    rev: number,
  ): { user_id: string; grant_id: string }[] {
    const grants =
      field === "resource"
        ? this.grants(value)
        : this.grantsTo("user", value).filter((g) => !g.deleted);
    const projections: { user_id: string; grant_id: string }[] = [];
    for (const grant of grants) {
      this.putGrant({ ...grant, deleted: 1, rev });
      for (const row of this.db.all<{ user_id: string; grant_id: string }>(
        "SELECT user_id,grant_id FROM authority_grant_projections WHERE grant_id=?",
        grant.id,
      )) {
        this.projectGrant(row.user_id, row.grant_id, rev, true);
        projections.push(row);
      }
    }
    return projections;
  }
  allGrants(): Grant[] {
    return this.db.all("SELECT * FROM authority_grants ORDER BY rev,id");
  }
  users(): string[] {
    return this.identity.activeUserIds();
  }
  putGrant(grant: Grant): void {
    this.db.run(
      "INSERT INTO authority_grants VALUES(?,?,?,?,?,?,?) ON CONFLICT(resource,principal_type,principal) DO UPDATE SET level=excluded.level,rev=excluded.rev,deleted=excluded.deleted",
      grant.id,
      grant.resource,
      grant.principal_type,
      grant.principal,
      grant.level,
      grant.rev,
      grant.deleted,
    );
  }
}
