import { AppError } from "@talos/base";
import type { AiCredit, AiPolicy } from "@talos/contract";
import type { Uow, WriteContext } from "../../../kernel/persistence/uow.ts";
import type { AiRepo, RunRecord } from "../repo.ts";
export function windows(now: number): { day: string; week: string } {
  const date = new Date(now);
  const day = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return { day, week: date.toISOString().slice(0, 10) };
}
export class Billing {
  constructor(
    readonly repo: Pick<
      AiRepo,
      | "account"
      | "policy"
      | "usage"
      | "active"
      | "get"
      | "put"
      | "putAccount"
      | "finishRun"
      | "addLedger"
      | "ledger"
      | "setPolicy"
    >,
    readonly uow: Uow,
    readonly now: () => number,
    readonly configured: () => boolean,
  ) {}
  account(user: string): AiCredit {
    const account = this.repo.account(user),
      policy = this.repo.policy(),
      window = windows(this.now()),
      usage = this.repo.usage(user, window.day, window.week),
      active = this.repo.active(user),
      reserved = active.reduce((n, r) => n + r.reserved, 0),
      held = active.reduce((n, r) => n + r.topup, 0),
      plan =
        account.plan_ends > this.now()
          ? Math.max(
              0,
              Math.min(policy.daily - usage.day, policy.weekly - usage.week),
            )
          : 0;
    return {
      id: "account",
      configured: this.configured(),
      topup: account.topup,
      reserved,
      daily: policy.daily,
      weekly: policy.weekly,
      dayUsed: usage.day,
      weekUsed: usage.week,
      available: Math.max(0, account.topup - held) + plan,
      planEnds: account.plan_ends,
      required: 1000000,
    };
  }
  project(user: string, ctx: WriteContext): AiCredit {
    const value = this.account(user);
    if (
      JSON.stringify(this.repo.get(user, "aiCredit", "account")) ===
      JSON.stringify(value)
    )
      return value;
    this.repo.put(user, "aiCredit", "account", value, ctx.rev);
    ctx.changed(`me:${user}`, "aiCredit", "account");
    return value;
  }
  reserve(
    user: string,
    amount: number,
  ): { plan: number; topup: number; day: string; week: string } {
    const account = this.account(user);
    if (account.available < amount)
      throw new AppError("E_DENIED", "额度不足，请联系功能管理员充值", {
        required: amount,
        available: account.available,
      });
    const plan =
      account.planEnds > this.now()
        ? Math.max(
            0,
            Math.min(
              amount,
              account.daily - account.dayUsed,
              account.weekly - account.weekUsed,
            ),
          )
        : 0;
    return { ...windows(this.now()), plan, topup: amount - plan };
  }
  settle(
    r: RunRecord,
    state: string,
    charged: number,
    ctx: WriteContext,
  ): void {
    if (!["queued", "running"].includes(r.state)) return;
    const amount = Math.min(r.reserved, Math.max(0, Math.ceil(charged))),
      topup = Math.max(0, amount - r.plan),
      a = this.repo.account(r.user);
    this.repo.putAccount(r.user, a.topup - topup, a.plan_ends);
    this.repo.finishRun(r.id, state, amount);
    this.repo.addLedger(
      r.id,
      r.user,
      "consumption",
      -amount,
      state,
      this.now(),
    );
    this.project(r.user, ctx);
  }
  assign(args: {
    user: string;
    key: string;
    amount: number;
    days: number;
    note: string;
  }): AiCredit {
    return this.uow.write((ctx) => {
      const fingerprint = JSON.stringify(args),
        old = this.repo.ledger(args.key);
      if (old) {
        if (old.fingerprint !== fingerprint)
          throw new AppError("E_CONFLICT", "充值操作标识已被使用");
        return this.account(args.user);
      }
      if (!args.amount && !args.days)
        throw new AppError("E_INVALID", "请填写充值数量或套餐天数");
      const a = this.repo.account(args.user);
      if (a.topup + args.amount > 1e12)
        throw new AppError("E_TOO_LARGE", "充值余额超出上限");
      this.repo.putAccount(
        args.user,
        a.topup + args.amount,
        args.days
          ? Math.max(this.now(), a.plan_ends) + args.days * 86400000
          : a.plan_ends,
      );
      this.repo.addLedger(
        args.key,
        args.user,
        "assignment",
        args.amount,
        args.note,
        this.now(),
        fingerprint,
      );
      return this.project(args.user, ctx);
    });
  }
  policy(value: AiPolicy, users: readonly string[]): { ok: true } {
    return this.uow.write((ctx) => {
      this.repo.setPolicy(value);
      for (const user of users) this.project(user, ctx);
      return { ok: true };
    });
  }
}
