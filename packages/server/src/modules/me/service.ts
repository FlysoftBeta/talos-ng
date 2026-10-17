import { AppError } from "@talos/base";
import { contract, MAX_FUTURE_SKEW_MS } from "@talos/contract";
import type { ArgsOf } from "@talos/contract";
import { clampFutureStamp, lwwMerge } from "@talos/sync";
import type { Row } from "@talos/sync";
import { migrate } from "../../kernel/persistence/db.ts";
import type { Db } from "../../kernel/persistence/db.ts";
import type { Uow } from "../../kernel/persistence/uow.ts";
import type { SyncHub, ScopeProvider } from "../../kernel/sync/sync-hub.ts";
import type { IdentityProfiles } from "../identity/ports.ts";
import { meMigrations } from "./schema.ts";
import { MeRepo } from "./repo.ts";
import type { Setting } from "./repo.ts";
export interface MeOptions {
  db: Db;
  uow: Uow;
  identity: IdentityProfiles;
  now?: () => number;
}
export class MeService {
  readonly repo: MeRepo;
  private readonly now: () => number;
  constructor(private readonly options: MeOptions) {
    this.now = options.now ?? Date.now;
    migrate(options.db, "me", meMigrations, this.now);
    this.repo = new MeRepo(options.db);
  }
  set(
    user: string,
    args: ArgsOf<typeof contract.me.setting.set>,
  ): { setting: Setting } {
    const parsed = contract.me.setting.set.args.safeParse(args);
    if (!parsed.success) throw new AppError("E_INVALID", "设置无效");
    const input = parsed.data;
    const value = {
      ...input.value,
      t: clampFutureStamp(input.value.t, this.now(), MAX_FUTURE_SKEW_MS).stamp,
    };
    return this.options.uow.write((ctx) => {
      const existing = this.repo.get(user, input.key);
      const merged = existing ? lwwMerge(existing.value, value) : value;
      if (existing && merged === existing.value) return { setting: existing };
      this.repo.put(user, input.key, merged, ctx.rev);
      ctx.changed(`me:${user}`, "setting", input.key);
      return { setting: { id: input.key, key: input.key, value: merged } };
    });
  }
  registerSync(hub: SyncHub): () => void {
    const provider: ScopeProvider = {
      match: (scope) => scope.startsWith("me:"),
      access: (user, scope) =>
        scope === `me:${user}` && this.options.identity.active(user),
      list: (user) =>
        this.options.identity.active(user) ? [`me:${user}`] : [],
      select: (scope, since, limit) =>
        this.select(scope.slice(3), since, limit),
    };
    const off = [
      hub.registerProvider(provider),
      hub.registerEntity("profile", {
        serialize: (row) => row,
        read: (scope, id) =>
          scope === `me:${id}` ? this.options.identity.profile(id) : undefined,
      }),
      hub.registerEntity("setting", {
        accessNeutral: true,
        serialize: (row) => row,
        read: (scope, id) => this.repo.read(scope.slice(3), id),
      }),
    ];
    return () => off.forEach((fn) => fn());
  }
  private select(user: string, since: number, limit: number): Row[] {
    const profile = this.options.identity.profile(user);
    return [
      ...(profile && profile.rev > since ? [profile] : []),
      ...this.repo.select(user, since, limit),
    ]
      .sort(
        (a, b) =>
          a.rev - b.rev ||
          (a.type < b.type
            ? -1
            : a.type > b.type
              ? 1
              : a.id < b.id
                ? -1
                : a.id > b.id
                  ? 1
                  : 0),
      )
      .slice(0, limit);
  }
}
