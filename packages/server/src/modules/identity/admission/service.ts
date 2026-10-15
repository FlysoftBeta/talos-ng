import { AppError } from "@talos/base";
import { PIN_FAILURE_LIMIT, PIN_THROTTLE_MS } from "@talos/contract";
import type { DeviceRecord, UserRecord } from "../ports.ts";
import type { AdmissionQueries } from "./ports.ts";
import type { DirectoryQueries } from "../directory/ports.ts";
interface AdmissionOptions {
  admission: Pick<
    AdmissionQueries,
    | "clearThrottle"
    | "device"
    | "failIp"
    | "failedPin"
    | "ipThrottle"
    | "policy"
  >;
  directory: Pick<
    DirectoryQueries,
    "boundUserExists" | "isBanned" | "publicUser" | "user"
  >;
  now: () => number;
}
export class AdmissionService {
  constructor(private readonly options: AdmissionOptions) {}
  admitDevice(id: string, ip?: string): DeviceRecord {
    const device = this.options.admission.device(id);
    if (!device)
      this.denied(
        "invalid-client",
        "此设备编号无效，请重置本机数据后重新连接",
        "E_UNAUTHENTICATED",
      );
    if (device!.banned) this.denied("banned", "此设备已被封禁");
    if (this.options.admission.policy().whitelist && !device!.whitelisted)
      this.denied("whitelist-required", "此设备尚未加入白名单，请联系管理员");
    const until = Math.max(
      device!.blocked_until,
      ip ? (this.options.admission.ipThrottle(ip)?.blocked_until ?? 0) : 0,
    );
    if (until > this.options.now())
      throw new AppError("E_RATE_LIMITED", "PIN 尝试次数过多，请稍后重试", {
        reason: "throttled",
        retryAt: until,
      });
    if (device!.blocked_until) {
      this.options.admission.clearThrottle(id);
      device!.failures = 0;
    }
    return device!;
  }
  admitUser(id: string, device: DeviceRecord): UserRecord {
    const user = this.options.directory.user(id);
    if (!user || user.deleted || user.purging)
      throw new AppError("E_DENIED", "用户不可用");
    if (this.options.directory.isBanned(user))
      throw new AppError("E_DENIED", "此账户已被封禁", {
        reason: "banned",
        retryAt: user.banned_until ?? undefined,
      });
    if (
      device.bound_user &&
      this.options.directory.boundUserExists(device.bound_user) &&
      device.bound_user !== id
    )
      this.denied("bound-to-other-user", "此设备已绑定其他用户");
    const policy = this.options.admission.policy();
    const administrator = this.options.directory
      .publicUser(user)
      .roles.includes("administrator");
    if (policy.system_lock && !administrator)
      this.denied(
        "system-lock",
        "系统已锁定，请等待管理员解除锁定",
        "E_LOCKED",
      );
    if (
      policy.idle_lock &&
      !administrator &&
      this.options.now() - device.last_seen > 5 * 60 * 1000
    )
      this.denied(
        "idle-lock",
        "设备因闲置已锁定，请联系管理员解锁",
        "E_LOCKED",
      );
    return user;
  }
  denied(
    reason: string,
    message: string,
    code: "E_DENIED" | "E_LOCKED" | "E_UNAUTHENTICATED" = "E_DENIED",
  ): never {
    throw new AppError(code, message, { reason });
  }
  failedPin(device: DeviceRecord, ip?: string): never {
    const failures = device.failures + 1;
    const deviceUntil =
      failures >= PIN_FAILURE_LIMIT ? this.options.now() + PIN_THROTTLE_MS : 0;
    const ipUntil = ip
      ? this.options.admission.failIp(
          ip,
          this.options.now(),
          PIN_FAILURE_LIMIT * 4,
          PIN_THROTTLE_MS,
        )
      : 0;
    this.options.admission.failedPin(
      device.id,
      failures,
      deviceUntil,
      this.options.now(),
    );
    const retryAt = Math.max(deviceUntil, ipUntil);
    throw new AppError(
      retryAt ? "E_RATE_LIMITED" : "E_UNAUTHENTICATED",
      retryAt ? "PIN 尝试次数过多，请稍后重试" : "PIN 无效",
      retryAt ? { reason: "throttled", retryAt } : { reason: "invalid-pin" },
    );
  }
}
