import { AppError } from "@talos/base";
import type { AdminSettings, ArgsOf, contract } from "@talos/contract";
import type { Db } from "../../../kernel/persistence/db.ts";
import type { AuditWriter } from "../../../kernel/diagnostics/ports.ts";
import type { IdentityAdmin } from "../../identity/ports.ts";
import { AdminRepo } from "../repo.ts";

export interface AdminPolicyOptions {
  audit: AuditWriter;
  db: Db;
  identity: Pick<IdentityAdmin, "directory" | "devices">;
}
export class AdminPolicy {
  private readonly repo: AdminRepo;
  constructor(private readonly options: AdminPolicyOptions) {
    this.repo = new AdminRepo(options.db);
  }
  settings(): AdminSettings {
    const policy = this.options.identity.devices.policy();
    return {
      whitelist: !!policy.whitelist,
      systemLock: !!policy.system_lock,
      idleLock: !!policy.idle_lock,
      identitySignals: JSON.parse(
        policy.identity_signals,
      ) as AdminSettings["identitySignals"],
      ...this.repo.settings(),
    };
  }
  maxVolume(): number {
    return this.repo.settings().maxVolume;
  }
  setPolicy(
    actor: string,
    input: ArgsOf<typeof contract.admin.device.policy.set>,
    actorDevice: string,
  ): AdminSettings {
    const current = this.settings();
    if (input.whitelist === true) {
      const device = this.options.identity.directory.device(actorDevice);
      if (!device) throw new AppError("E_DENIED", "当前设备不存在");
      this.options.identity.directory.whitelistDevice(actorDevice);
    }
    this.options.db.tx(() => {
      this.options.identity.devices.setPolicy({
        whitelist: input.whitelist ?? current.whitelist,
        systemLock: input.systemLock ?? current.systemLock,
        idleLock: input.idleLock ?? current.idleLock,
        identitySignals: input.identitySignals ?? current.identitySignals,
      });
      this.options.audit.append(actor, "admin.device.policy.set", null, input);
    });
    return this.settings();
  }
  setMediaSettings(
    actor: string,
    input: ArgsOf<typeof contract.admin.settings.set>,
  ): AdminSettings {
    const current = this.settings();
    this.options.db.tx(() => {
      this.options.db.run(
        "UPDATE admin_settings SET max_volume=?,eviction_days=? WHERE id=1",
        input.maxVolume ?? current.maxVolume,
        input.evictionDays ?? current.evictionDays,
      );
      this.options.audit.append(actor, "admin.settings.set", null, input);
    });
    return this.settings();
  }
}
