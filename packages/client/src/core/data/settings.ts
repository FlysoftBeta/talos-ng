import type { HybridClock } from "@talos/base";
import type { ArgsOf, JsonValue, Method, ResultOf } from "@talos/contract";
import { contract } from "@talos/contract";
import type { SavedSession } from "../auth/session.ts";
import type { SyncEngine } from "./sync-engine.ts";

export interface SettingsControllerPorts {
  id: () => string;
  command<M extends Method>(
    method: M,
    args: ArgsOf<M>,
    options?: { op?: string; body?: Uint8Array; timeoutMs?: number },
  ): Promise<ResultOf<M> | { queued: string }>;
  clock: HybridClock;
  resetIdle(): void;
  engine?: SyncEngine;
  saved?: SavedSession;
}

export class SettingsController {
  constructor(private readonly ports: SettingsControllerPorts) {}
  async setSetting(key: string, value: JsonValue): Promise<void> {
    const op = this.ports.id();
    await this.ports.command(
      contract.me.setting.set,
      { key, value: { v: value, t: this.ports.clock.now(), op } },
      { op },
    );
    if (key === "idleLockMinutes") this.ports.resetIdle();
  }
  setting<T>(key: string, fallback: T): T {
    const row = this.ports.engine
      ?.getSnapshot()
      .rows.find(
        (r) =>
          r.type === "setting" &&
          r.scope === `me:${this.ports.saved?.user.id}` &&
          r.id === key &&
          !r.deleted,
      );
    const parsed = contract.me.setting.set.result.safeParse({
      setting: row?.data,
    });
    return parsed.success ? (parsed.data.setting.value.v as T) : fallback;
  }
  settingMark(key: string): "pending" | "failed" | undefined {
    const ops =
      this.ports.engine
        ?.getSnapshot()
        .outbox.filter(
          (op) =>
            op.method === "me.setting.set" &&
            (op.args as { key?: string }).key === key,
        ) ?? [];
    return ops.some((op) => op.state === "failed")
      ? "failed"
      : ops.length
        ? "pending"
        : undefined;
  }
}
