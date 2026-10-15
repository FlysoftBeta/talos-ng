import { AppError } from "@talos/base";
import type { CancellationSignal } from "@talos/base";
import type { Jobs } from "../kernel/jobs/jobs.ts";
import type { Uow } from "../kernel/persistence/uow.ts";
import type {
  IdentityPurgePort,
  UserPurgeParticipant,
} from "../kernel/persistence/user-purge.ts";

/** Preparation survives failure; all domain cleanup shares one final revision. */
export class UserPurgeRegistry {
  private readonly participants: UserPurgeParticipant[] = [];
  constructor(
    private readonly options: {
      uow: Uow;
      identity: IdentityPurgePort;
      quiesce(user: string): Promise<void>;
    },
  ) {}
  register(participant: UserPurgeParticipant): void {
    if (
      participant.owner === this.options.identity.owner ||
      this.participants.some((p) => p.owner === participant.owner)
    )
      throw new AppError("E_CONFLICT", "用户清除参与者重复注册");
    this.participants.push(participant);
  }
  async run(
    user: string,
    signal?: CancellationSignal,
  ): Promise<{ user: string }> {
    const { identity, uow } = this.options;
    if (!identity.exists(user)) return { user };
    uow.write((tx) => {
      identity.assertPurgeAllowed(user);
      identity.prepare(user, tx);
    });
    await this.options.quiesce(user);
    if (signal?.aborted) throw new AppError("E_CANCELLED", "任务已取消");
    uow.write((tx) => {
      if (!identity.exists(user)) return;
      identity.assertPurgeAllowed(user);
      for (const participant of [...this.participants, identity]) {
        const result: unknown = participant.purgeUser(user, tx);
        if (
          result !== null &&
          (typeof result === "object" || typeof result === "function") &&
          "then" in result &&
          typeof result.then === "function"
        ) {
          void Promise.resolve(result).catch(() => {});
          throw new AppError("E_CONFLICT", "用户清除参与者必须同步执行");
        }
      }
    });
    return { user };
  }
  registerJob(jobs: Jobs): void {
    jobs.register("admin.user.purge", {
      concurrency: 1,
      timeoutMs: 300_000,
      onBoot: "requeue",
      retryable: true,
      run: async (ctx) => {
        const user = (ctx.payload as { user?: unknown } | null)?.user;
        if (typeof user !== "string")
          throw new AppError("E_INVALID", "清除目标无效");
        const result = await this.run(user, ctx.signal);
        ctx.progress(1, "身份已清除");
        return result;
      },
    });
  }
}
