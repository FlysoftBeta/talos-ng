import { AppError } from "@talos/base";
import type { AdminUser, ArgsOf, contract } from "@talos/contract";
import type { Uow } from "../../../kernel/persistence/uow.ts";
import type { AuditWriter } from "../../../kernel/diagnostics/ports.ts";
import type { Jobs } from "../../../kernel/jobs/jobs.ts";
import type { IdentityAdmin } from "../../identity/ports.ts";
import type { AuthorityAdmin } from "../../authority/ports.ts";
import type { ChatAdmin } from "../../chat/ports.ts";
import { AdminUsersQuery } from "./query.ts";
export interface AdminUsersOptions {
  audit: AuditWriter;
  authority: Pick<AuthorityAdmin, "actor" | "roots" | "setAccess">;
  chat: Pick<ChatAdmin, "mute" | "adminQueries">;
  identity: IdentityAdmin;
  jobs: Jobs;
  onBanPending?: (user: string, until: number | null) => () => void;
  uow: Uow;
  now?: () => number;
}
export class AdminUsers {
  private readonly repo: AdminUsersQuery;
  private readonly now: () => number;
  constructor(private readonly options: AdminUsersOptions) {
    this.repo = new AdminUsersQuery(
      options.identity.directory,
      options.chat.adminQueries,
    );
    this.now = options.now ?? Date.now;
  }
  listUsers(input: ArgsOf<typeof contract.admin.user.list>): {
    items: AdminUser[];
    total: number;
  } {
    return this.repo.users(
      input.query ?? "",
      input.offset ?? 0,
      input.limit ?? 50,
      input.sort,
    );
  }
  createUser(
    actor: string,
    input: ArgsOf<typeof contract.admin.user.create>,
  ): { user: AdminUser } {
    const user = this.options.identity.createUser({
      pin: input.pin,
      handle: input.handle,
      name: input.name ?? input.handle,
    });
    if (input.features)
      this.options.authority.setAccess(user.id, { features: input.features });
    this.options.audit.append(actor, "admin.user.create", user.id, {
      handle: input.handle,
    });
    return { user: this.repo.user(user.id)! };
  }
  async updateUser(
    actor: string,
    input: ArgsOf<typeof contract.admin.user.update>,
  ): Promise<{ user: AdminUser }> {
    const current = this.repo.user(input.id);
    if (!current) throw new AppError("E_NOT_FOUND", "用户不存在");
    if (input.bannedUntil !== undefined && input.banned !== true)
      throw new AppError("E_INVALID", "封禁时长必须与封禁操作一起提交");
    if (input.deactivated === true && actor === input.id)
      throw new AppError("E_DENIED", "不能停用自己");
    if (input.pin)
      await this.options.identity.adminResetPin(input.id, input.pin);
    const notifyBan =
      input.banned === true
        ? this.options.onBanPending?.(input.id, input.bannedUntil ?? null)
        : undefined;
    this.options.uow.write((ctx) => {
      // Recheck inside the write after asynchronous credential hashing.
      if (
        (input.deactivated === true || input.banned === true) &&
        this.options.authority.actor(input.id)?.roles.includes("root") &&
        this.options.authority.roots() <= 1
      )
        throw new AppError("E_CONFLICT", "不能停用或封禁最后一位根管理员");
      if (input.handle !== undefined || input.name !== undefined) {
        if (
          input.handle !== undefined &&
          input.handle.toLowerCase() !== current.handle.toLowerCase() &&
          this.options.identity.repo.hasHandle(input.handle)
        )
          throw new AppError("E_CONFLICT", "用户名已被使用");
        this.options.identity.profileCommands.updateProfile(
          input.id,
          input.handle ?? current.handle,
          input.name ?? current.name,
          ctx.rev,
        );
        ctx.changed(`me:${input.id}`, "profile", input.id);
      }
      if (input.roles !== undefined || input.features !== undefined)
        this.options.authority.setAccess(input.id, {
          roles: input.roles,
          features: input.features,
        });
      if (input.mutedUntil !== undefined)
        this.options.chat.mute(input.id, input.mutedUntil);
      if (input.banned !== undefined || input.deactivated !== undefined)
        this.options.identity.adminSetStatus(input.id, {
          banned: input.banned,
          bannedUntil: input.bannedUntil,
          deactivated: input.deactivated,
        });
      if (notifyBan) ctx.afterCommit(notifyBan);
      const fields = Object.entries(input)
        .filter(([key, value]) => key !== "id" && value !== undefined)
        .map(([key]) => key);
      this.options.audit.append(actor, "admin.user.update", input.id, {
        fields,
      });
    });
    return { user: this.repo.user(input.id)! };
  }
  async bulkUsers(
    actor: string,
    input: ArgsOf<typeof contract.admin.user.bulk>,
  ): Promise<{ results: { id: string; ok: boolean; error?: string }[] }> {
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of [...new Set(input.ids)]) {
      try {
        const current = this.repo.user(id);
        if (!current) throw new AppError("E_NOT_FOUND", "用户不存在");
        const features = new Set(current.features);
        const roles = new Set(current.roles);
        for (const [feature, change] of Object.entries(
          input.gateChanges ?? {},
        )) {
          if (change === "enable")
            features.add(feature as (typeof current.features)[number]);
          if (change === "disable")
            features.delete(feature as (typeof current.features)[number]);
        }
        for (const [role, change] of Object.entries(input.roleChanges ?? {})) {
          if (change === "enable")
            roles.add(role as (typeof current.roles)[number]);
          if (change === "disable")
            roles.delete(role as (typeof current.roles)[number]);
        }
        await this.updateUser(actor, {
          id,
          ...input.changes,
          ...(input.changes?.banned && current.banned
            ? { banned: undefined, bannedUntil: undefined }
            : {}),
          ...(input.changes?.mutedUntil && current.mutedUntil > this.now()
            ? { mutedUntil: current.mutedUntil }
            : {}),
          ...(input.gateChanges ? { features: [...features] } : {}),
          ...(input.roleChanges ? { roles: [...roles] } : {}),
        });
        results.push({ id, ok: true });
      } catch (error) {
        results.push({
          id,
          ok: false,
          error: error instanceof Error ? error.message : "操作失败",
        });
      }
    }
    this.options.audit.append(actor, "admin.user.bulk", null, {
      requested: input.ids.length,
      succeeded: results.filter((r) => r.ok).length,
    });
    return { results };
  }
  purgeUser(actor: string, user: string): { jobId: string } {
    const current = this.repo.user(user);
    if (!current) throw new AppError("E_NOT_FOUND", "用户不存在");
    if (actor === user) throw new AppError("E_DENIED", "不能清除自己");
    if (
      this.options.authority.actor(user)?.roles.includes("root") &&
      this.options.authority.roots() <= 1
    )
      throw new AppError("E_CONFLICT", "不能清除最后一位根管理员");
    const job = this.options.jobs.enqueue(actor, "admin.user.purge", { user });
    this.options.audit.append(actor, "admin.user.purge", user, {
      jobId: job.id,
    });
    return { jobId: job.id };
  }
}
