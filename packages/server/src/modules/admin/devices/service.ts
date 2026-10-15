import { AppError } from "@talos/base";
import type { AdminDevice, ArgsOf, contract } from "@talos/contract";
import type { Db } from "../../../kernel/persistence/db.ts";
import type { AuditWriter } from "../../../kernel/diagnostics/ports.ts";
import type { IdentityAdmin } from "../../identity/ports.ts";
import type { AdminPolicy } from "../policy/service.ts";
export interface AdminDevicesOptions {
  audit: AuditWriter;
  db: Db;
  identity: Pick<IdentityAdmin, "repo" | "directory">;
  policy: Pick<AdminPolicy, "settings">;
}
export class AdminDevices {
  constructor(private readonly options: AdminDevicesOptions) {}
  listDevices(input: ArgsOf<typeof contract.admin.device.list>) {
    return this.options.identity.directory.devices(
      input.query ?? "",
      input.offset ?? 0,
      input.limit ?? 50,
    );
  }
  updateDevice(
    actor: string,
    input: ArgsOf<typeof contract.admin.device.update>,
    actorDevice: string,
  ): { device: AdminDevice } {
    const current = this.options.identity.directory.device(input.id);
    if (!current) throw new AppError("E_NOT_FOUND", "设备不存在");
    if (input.id === actorDevice && input.locked === true)
      throw new AppError("E_DENIED", "不能锁定当前设备");
    if (
      input.id === actorDevice &&
      input.whitelisted === false &&
      this.options.policy.settings().whitelist
    )
      throw new AppError("E_DENIED", "不能移出当前设备的白名单");
    if (input.boundUser && !this.options.identity.repo.user(input.boundUser))
      throw new AppError("E_NOT_FOUND", "绑定用户不存在");
    this.options.db.tx(() => {
      this.options.identity.directory.updateDevice({
        ...current,
        label: input.label ?? current.label,
        boundUser:
          input.boundUser === undefined ? current.boundUser : input.boundUser,
        whitelisted: input.whitelisted ?? current.whitelisted,
        locked: input.locked ?? current.locked,
        persistent: input.persistent ?? current.persistent,
      });
      if (input.locked === true)
        this.options.identity.directory.revokeDeviceSessions(input.id);
      this.options.audit.append(actor, "admin.device.update", input.id, {
        fields: Object.keys(input).filter((k) => k !== "id"),
      });
    });
    return { device: this.options.identity.directory.device(input.id)! };
  }
  deleteDevice(actor: string, id: string, actorDevice: string): void {
    if (id === actorDevice) throw new AppError("E_DENIED", "不能删除当前设备");
    this.options.db.tx(() => {
      this.options.identity.directory.revokeDeviceSessions(id);
      const removed = this.options.identity.directory.deleteDevice(id);
      if (!removed) throw new AppError("E_NOT_FOUND", "设备不存在");
      this.options.audit.append(actor, "admin.device.delete", id);
    });
  }
}
