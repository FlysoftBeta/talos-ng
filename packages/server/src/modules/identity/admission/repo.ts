import { createHash } from "node:crypto";
import { AppError } from "@talos/base";

import type { Db } from "../../../kernel/persistence/db.ts";

import type { DeviceRecord } from "../ports.ts";
export class AdmissionRepo {
  constructor(private readonly db: Db) {}
  device(id: string): DeviceRecord | undefined {
    return this.db.get<DeviceRecord>("SELECT * FROM devices WHERE id=?", id);
  }
  bindDeviceSignals(id: string, ip?: string, userAgent?: string): void {
    this.db.run(
      "UPDATE devices SET ip_hash=?,user_agent_hash=? WHERE id=?",
      ip ? signalHash(ip) : null,
      userAgent ? signalHash(userAgent) : null,
      id,
    );
  }
  checkDeviceSignals(id: string, ip?: string, userAgent?: string): void {
    const policy = this.policy();
    const signals = JSON.parse(policy.identity_signals) as string[];
    const row = this.db.get<{
      ip_hash: string | null;
      user_agent_hash: string | null;
    }>("SELECT ip_hash,user_agent_hash FROM devices WHERE id=?", id);
    if (!row) return;
    for (const [selected, stored, actual] of [
      ["ip", row.ip_hash, ip],
      ["userAgent", row.user_agent_hash, userAgent],
    ] as const) {
      if (!signals.includes(selected)) continue;
      if (!actual) continue; // Local transports have no network metadata.
      const hash = signalHash(actual);
      if (stored && stored !== hash)
        throw new AppError(
          "E_UNAUTHENTICATED",
          "设备识别信息已变化，请联系管理员",
          { reason: "device-signal-changed" },
        );
      if (!stored)
        this.db.run(
          `UPDATE devices SET ${selected === "ip" ? "ip_hash" : "user_agent_hash"}=? WHERE id=?`,
          hash,
          id,
        );
    }
  }
  createDevice(id: string, label: string, now: number): void {
    this.db.run(
      "INSERT INTO devices(id,label,last_seen,persistent) VALUES(?,?,?,0)",
      id,
      label,
      now,
    );
  }
  failedPin(
    device: string,
    failures: number,
    blockedUntil: number,
    now: number,
  ): void {
    this.db.run(
      "UPDATE devices SET failures=?,blocked_until=?,last_seen=? WHERE id=?",
      failures,
      blockedUntil,
      now,
      device,
    );
  }
  clearThrottle(device: string): void {
    this.db.run(
      "UPDATE devices SET failures=0,blocked_until=0 WHERE id=?",
      device,
    );
  }
  setPolicy(input: {
    whitelist: boolean;
    systemLock: boolean;
    idleLock: boolean;
    identitySignals: readonly string[];
  }): void {
    this.db.run(
      "UPDATE identity_policy SET whitelist=?,system_lock=?,idle_lock=?,identity_signals=? WHERE id=1",
      Number(input.whitelist),
      Number(input.systemLock),
      Number(input.idleLock),
      JSON.stringify(input.identitySignals),
    );
  }
  policy(): {
    whitelist: number;
    system_lock: number;
    idle_lock: number;
    identity_signals: string;
  } {
    return this.db.get("SELECT * FROM identity_policy WHERE id=1")!;
  }
  ipThrottle(
    ip: string,
  ): { failures: number; blocked_until: number } | undefined {
    return this.db.get("SELECT * FROM identity_ip_throttle WHERE ip=?", ip);
  }
  failIp(ip: string, now: number, limit: number, duration: number): number {
    const previous = this.ipThrottle(ip);
    const failures =
      (previous && (!previous.blocked_until || previous.blocked_until > now)
        ? previous.failures
        : 0) + 1;
    const until = failures >= limit ? now + duration : 0;
    this.db.run(
      "INSERT INTO identity_ip_throttle VALUES(?,?,?) ON CONFLICT(ip) DO UPDATE SET failures=excluded.failures,blocked_until=excluded.blocked_until",
      ip,
      failures,
      until,
    );
    return until;
  }
}
function signalHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
