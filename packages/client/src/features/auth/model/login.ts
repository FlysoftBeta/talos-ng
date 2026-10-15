export type LockReason = "manual" | "idle";

export function loginHeading(locked: boolean, reason?: LockReason): string {
  return locked ? (reason === "idle" ? "闲置已锁定" : "已锁定") : "欢迎回来";
}

export function loginIntro(locked: boolean, name?: string): string {
  return locked
    ? `${name || "当前账号"}，输入 PIN 继续`
    : "输入六位 PIN 或邀请码";
}
