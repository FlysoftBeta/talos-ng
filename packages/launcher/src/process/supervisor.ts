import { AppError } from "@talos/base";
export interface PendingRelease {
  previous: string;
  build: string;
  deadline: number;
  backup: string;
}
export interface LauncherState {
  current: string;
  pending?: PendingRelease;
}
export interface ServerChild {
  stop(): Promise<void>;
  onExit(fn: () => void): void;
  onMessage(fn: (message: unknown) => void): void;
}
export interface SupervisorOptions {
  now(): number;
  schedule(fn: () => void, ms: number): unknown;
  cancel(timer: unknown): void;
  read(): Promise<LauncherState>;
  save(state: LauncherState): Promise<void>;
  start(build: string): Promise<ServerChild>;
  restore(backup: string, previous: string): Promise<void>;
  incident(message: string): Promise<void>;
  /** Deletes every installed version but these. */
  prune(keep: readonly string[]): Promise<void>;
  deadlineMs?: number;
}
/** Serialized transitions. The durable pending record precedes launching new code. */
export class Supervisor {
  private state!: LauncherState;
  private child?: ServerChild;
  private timer: unknown;
  private watchdog: unknown;
  private stopped = false;
  private crashes = 0;
  private chain: Promise<void> = Promise.resolve();
  constructor(private readonly io: SupervisorOptions) {}
  private static message(error: unknown): string {
    return error instanceof Error ? error.message : "启动器失败";
  }
  private enqueue(fn: () => Promise<void>): Promise<void> {
    const next = this.chain.then(fn);
    this.chain = next.catch(async (error) => {
      await this.io.incident(Supervisor.message(error));
    });
    return next;
  }
  boot(): Promise<void> {
    return this.enqueue(async () => {
      this.state = await this.io.read();
      if (this.state.pending && this.state.pending.deadline <= this.io.now())
        await this.rollback("确认期限已过");
      else {
        if (!this.state.pending) await this.prune([this.state.current]);
        await this.launch();
      }
    });
  }
  /** Old versions go once nothing can roll back to them; failing to delete one is only an incident. */
  private async prune(keep: string[]): Promise<void> {
    try {
      await this.io.prune(keep);
    } catch (error) {
      await this.io.incident(`无法删除旧版本：${Supervisor.message(error)}`);
    }
  }
  private scheduleRestart(): void {
    this.timer = this.io.schedule(
      () => {
        void this.enqueue(async () => {
          if (this.stopped) return;
          if (this.state.pending) {
            await this.rollback("候选版本退出");
            return;
          }
          try {
            await this.launch();
          } catch (error) {
            // A failed restart keeps retrying; only the first boot gives up.
            await this.io.incident(Supervisor.message(error));
            this.scheduleRestart();
          }
        }).catch(() => {});
      },
      Math.min(30_000, 500 * 2 ** Math.min(this.crashes++, 6)),
    );
  }
  private async launch(): Promise<void> {
    if (this.stopped) return;
    const child = await this.io.start(this.state.current);
    this.child = child;
    child.onMessage((message) => {
      if (
        message &&
        typeof message === "object" &&
        (message as { type?: string }).type === "confirmed"
      )
        void this.confirm(child).catch(() => {});
    });
    child.onExit(() => {
      if (this.child !== child || this.stopped) return;
      this.child = undefined;
      this.scheduleRestart();
    });
    if (this.state.pending) {
      this.io.cancel(this.watchdog);
      this.watchdog = this.io.schedule(
        () => {
          void this.enqueue(() => this.rollback("版本未在期限内确认")).catch(
            () => {},
          );
        },
        Math.max(0, this.state.pending.deadline - this.io.now()),
      );
    }
  }
  private confirm(child: ServerChild): Promise<void> {
    return this.enqueue(async () => {
      if (this.child !== child || !this.state.pending || this.stopped) return;
      if (this.io.now() >= this.state.pending.deadline) {
        await this.rollback("确认迟到");
        return;
      }
      const confirmed = { current: this.state.current };
      await this.io.save(confirmed);
      this.state = confirmed;
      this.io.cancel(this.watchdog);
      this.crashes = 0;
      await this.prune([confirmed.current]);
    });
  }
  apply(build: string, backup: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped || this.state.pending || this.state.current === build)
        throw new AppError("E_CONFLICT", "无法应用此版本");
      await this.stopChild();
      const pendingState: LauncherState = {
        current: build,
        pending: {
          previous: this.state.current,
          build,
          backup,
          deadline: this.io.now() + (this.io.deadlineMs ?? 180_000),
        },
      };
      try {
        await this.io.save(pendingState);
      } catch (error) {
        // A failed pointer write may follow a successful durable state commit.
        this.state = await this.io.read();
        if (this.state.pending) await this.rollback("无法提交版本指针");
        else await this.launch();
        throw error;
      }
      this.state = pendingState;
      try {
        await this.launch();
      } catch {
        await this.rollback("候选版本无法启动");
      }
    });
  }
  private async rollback(reason: string): Promise<void> {
    const pending = this.state.pending;
    if (!pending || this.stopped) return;
    await this.stopChild();
    this.io.cancel(this.watchdog);
    await this.io.restore(pending.backup, pending.previous);
    const restored = { current: pending.previous };
    await this.io.save(restored);
    this.state = restored;
    // The rejected candidate goes too, so the same update can be staged again.
    await this.prune([restored.current]);
    await this.io.incident(
      `回滚 ${pending.build} → ${pending.previous}：${reason}`,
    );
    await this.launch();
  }
  private async stopChild(): Promise<void> {
    this.io.cancel(this.timer);
    const child = this.child;
    this.child = undefined;
    await child?.stop();
  }
  stop(): Promise<void> {
    this.stopped = true;
    return this.enqueue(async () => {
      this.io.cancel(this.watchdog);
      await this.stopChild();
    });
  }
  idle(): Promise<void> {
    return this.chain;
  }
}
