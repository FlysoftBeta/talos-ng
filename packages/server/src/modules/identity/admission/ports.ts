import type { DeviceRecord, UserRecord } from "../ports.ts";
export interface AdmissionQueries {
  device(id: string): DeviceRecord | undefined;
  bindDeviceSignals(id: string, ip?: string, userAgent?: string): void;
  checkDeviceSignals(id: string, ip?: string, userAgent?: string): void;
  createDevice(id: string, label: string, now: number): void;
  failedPin(
    device: string,
    failures: number,
    blockedUntil: number,
    now: number,
  ): void;
  clearThrottle(device: string): void;
  policy(): {
    whitelist: number;
    system_lock: number;
    idle_lock: number;
    identity_signals: string;
  };
  ipThrottle(
    ip: string,
  ): { failures: number; blocked_until: number } | undefined;
  failIp(ip: string, now: number, limit: number, duration: number): number;
}

export interface AdmissionPolicy {
  admitDevice(id: string, ip?: string): DeviceRecord;
  admitUser(id: string, device: DeviceRecord): UserRecord;
  denied(
    reason: string,
    message: string,
    code?: "E_DENIED" | "E_LOCKED" | "E_UNAUTHENTICATED",
  ): never;
  failedPin(device: DeviceRecord, ip?: string): never;
}
