import type { IdentityAuthorityDirectory } from "../identity/ports.ts";
import { AppError, createUlid } from "@talos/base";
import {
  rolesWithDependencies,
  hasFeature,
  opsActionRole,
  adminActionRole,
} from "@talos/contract";
import type {
  AdminRole,
  Feature,
  User,
  AuthorityAction,
} from "@talos/contract";
import type { Db } from "../../kernel/persistence/db.ts";
import { migrate } from "../../kernel/persistence/db.ts";
import type { Uow, WriteContext } from "../../kernel/persistence/uow.ts";
import type { Row } from "@talos/sync";
import type { SyncHub } from "../../kernel/sync/sync-hub.ts";
import type { Grant } from "./repo.ts";
import { AuthorityRepo } from "./repo.ts";
import { authorityMigrations } from "./schema.ts";
export interface AuthorityResource {
  id?: string;
  owner?: string;
  feature?: Feature;
}
export interface AuthorityOptions {
  identity: IdentityAuthorityDirectory;
  db: Db;
  uow: Uow;
  now?: () => number;
  groups?: (user: string) => readonly string[];
}
/** The single policy entry point. Group membership is supplied by community later. */
export class AuthorityService {
  readonly repo: AuthorityRepo;
  private readonly id: () => string;
  constructor(private readonly options: AuthorityOptions) {
    migrate(options.db, "authority", authorityMigrations, options.now);
    this.repo = new AuthorityRepo(options.db, options.identity);
    this.id = createUlid({ clock: options.now });
  }
  can(
    actor: string | User,
    action: AuthorityAction,
    resource: AuthorityResource = {},
  ): boolean {
    const user =
      typeof actor === "string"
        ? this.repo.actor(actor)
        : this.repo.actor(actor.id);
    if (!user) return false;
    const root = user.roles.includes("root");
    const opsRole = opsActionRole(action);
    if (opsRole) return root || user.roles.includes(opsRole);
    const adminRole = adminActionRole(action);
    if (adminRole) return root || user.roles.includes(adminRole);
    if (action === "admin.enter") return user.roles.includes("administrator");
    if (action === "identity.invitation.create")
      return root || user.roles.includes("access_manager");
    if (action === "authority.roles.set") return root;
    if (action === "authority.features.set")
      return root || user.roles.includes("feature_manager");
    if (action === "feature.use")
      return !!resource.feature && hasFeature(user.features, resource.feature);
    if (resource.feature && !hasFeature(user.features, resource.feature))
      return false;
    if (
      action !== "resource.read" &&
      action !== "resource.write" &&
      action !== "resource.own"
    )
      return false;
    if (resource.owner === user.id) return true;
    if (!resource.id) return false;
    const needed =
      action === "resource.own" ? 3 : action === "resource.write" ? 2 : 1;
    const groups = this.options.groups?.(user.id) ?? [];
    return this.repo
      .grants(resource.id)
      .some(
        (grant) =>
          (grant.principal_type === "user"
            ? grant.principal === user.id
            : groups.includes(grant.principal)) &&
          { read: 1, write: 2, own: 3 }[grant.level] >= needed,
      );
  }
  actor(id: string): User | undefined {
    return this.repo.actor(id);
  }
  /** Resource ids under `prefix` that some grant could open for the user. */
  grantedResources(user: string, prefix: string): string[] {
    return this.repo.grantedResources(
      user,
      this.options.groups?.(user) ?? [],
      prefix,
    );
  }
  roots(): number {
    return this.repo.roots();
  }
  setAccess(
    userId: string,
    input: { roles?: readonly AdminRole[]; features?: readonly Feature[] },
  ): void {
    const user = this.repo.actor(userId);
    if (!user) throw new AppError("E_NOT_FOUND", "用户不存在");
    const roles = input.roles
      ? [...rolesWithDependencies(input.roles)]
      : user.roles;
    if (
      user.roles.includes("root") &&
      !roles.includes("root") &&
      this.repo.roots() <= 1
    )
      throw new AppError("E_CONFLICT", "不能移除最后一位根管理员");
    this.options.uow.write((ctx) => {
      this.repo.setAccess(
        {
          ...user,
          roles,
          features: input.features
            ? [...new Set(input.features)]
            : user.features,
        },
        ctx.rev,
      );
      ctx.changed(`me:${userId}`, "profile", userId);
    });
  }
  /** Trusted migration seam with stable IDs and bounded projection batches. */
  importGrant(input: {
    id: string;
    resource: string;
    principalType: "user" | "group";
    principal: string;
    level: "read" | "write" | "own";
  }): void {
    this.options.uow.write((ctx) => {
      this.repo.putGrant({
        id: input.id,
        resource: input.resource,
        principal_type: input.principalType,
        principal: input.principal,
        level: input.level,
        rev: ctx.rev,
        deleted: 0,
      });
      let cursor = "";
      for (;;) {
        const users = this.options.identity.userIdsAfter(cursor, 500);
        if (!users.length) break;
        for (const user of users) {
          cursor = user.id;
          if (
            input.principalType === "user"
              ? user.id === input.principal
              : (this.options.groups?.(user.id) ?? []).includes(input.principal)
          ) {
            this.repo.projectGrant(user.id, input.id, ctx.rev, false);
            ctx.changed(`me:${user.id}`, "grant", input.id);
          }
        }
      }
    });
  }
  setGrant(input: {
    resource: string;
    principalType: "user" | "group";
    principal: string;
    level: "read" | "write" | "own" | null;
  }): void {
    this.options.uow.write((ctx) => {
      const grantId =
        this.repo
          .grants(input.resource)
          .find(
            (grant) =>
              grant.principal_type === input.principalType &&
              grant.principal === input.principal,
          )?.id ??
        this.repo
          .allGrants()
          .find(
            (grant) =>
              grant.resource === input.resource &&
              grant.principal_type === input.principalType &&
              grant.principal === input.principal,
          )?.id ??
        this.id();
      this.repo.putGrant({
        id: grantId,
        resource: input.resource,
        principal_type: input.principalType,
        principal: input.principal,
        level: input.level ?? "read",
        rev: ctx.rev,
        deleted: input.level === null ? 1 : 0,
      });
      for (const user of this.repo.users())
        if (
          input.principalType === "user"
            ? user === input.principal
            : (this.options.groups?.(user) ?? []).includes(input.principal)
        ) {
          this.repo.projectGrant(user, grantId, ctx.rev, input.level === null);
          ctx.changed(`me:${user}`, "grant", grantId);
        }
    });
  }
  revokeResource(resource: string, tx: WriteContext): void {
    for (const row of this.repo.revokeMatching("resource", resource, tx.rev))
      tx.changed(`me:${row.user_id}`, "grant", row.grant_id);
  }
  revokePrincipal(user: string, tx: WriteContext): void {
    for (const row of this.repo.revokeMatching("principal", user, tx.rev))
      tx.changed(`me:${row.user_id}`, "grant", row.grant_id);
  }
  /** Called inside the community membership transaction, after membership changes. */
  membershipChanged(user: string, group: string, ctx: WriteContext): void {
    for (const grant of this.repo.allGrants()) {
      if (grant.principal_type !== "group" || grant.principal !== group)
        continue;
      this.repo.projectGrant(
        user,
        grant.id,
        ctx.rev,
        !!grant.deleted || !this.visible(user, grant),
      );
      ctx.changed(`me:${user}`, "grant", grant.id);
    }
  }
  registerSync(hub: SyncHub): void {
    // Grants addressed to the user or their groups, plus every grant the user
    // holds a projection for (a revoked group grant stays as a tombstone).
    const rows = (user: string): Row[] => {
      const projections = new Map(
        this.repo.projections(user).map((row) => [row.grant_id, row]),
      );
      return this.repo
        .grantsFor(user, this.options.groups?.(user) ?? [])
        .map((grant) => {
          const projection = projections.get(grant.id);
          return this.grantRow(
            projection
              ? { ...grant, rev: projection.rev, deleted: projection.deleted }
              : grant,
          );
        })
        .sort((a, b) => a.rev - b.rev || a.id.localeCompare(b.id));
    };
    hub.registerProvider({
      match: (scope) => scope.startsWith("me:"),
      access: (user, scope) =>
        scope === `me:${user}` && !!this.repo.actor(user),
      list: (user) => (this.repo.actor(user) ? [`me:${user}`] : []),
      select: (scope, since, limit) =>
        rows(scope.slice(3))
          .filter((row) => row.rev > since)
          .slice(0, limit),
    });
    hub.registerEntity("grant", {
      serialize: (row) => row,
      read: (scope, id) => rows(scope.slice(3)).find((row) => row.id === id),
    });
  }
  private visible(user: string, grant: Grant): boolean {
    return grant.principal_type === "user"
      ? grant.principal === user
      : (this.options.groups?.(user) ?? []).includes(grant.principal);
  }
  private grantRow(grant: Grant): Row {
    return {
      type: "grant",
      id: grant.id,
      rev: grant.rev,
      deleted: !!grant.deleted,
      data: grant.deleted
        ? null
        : {
            id: grant.id,
            resource: grant.resource,
            principalType: grant.principal_type,
            principal: grant.principal,
            level: grant.level,
          },
    };
  }
}
