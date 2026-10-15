import { AppError, equals, fromHex, toHex, utf8Encode } from "@talos/base";
export interface PinVerifier {
  salt: string;
  hash: string;
  iterations: number;
}
export const PIN_ITERATIONS = 210_000;
async function derive(
  pin: string,
  salt: Uint8Array,
  iterations: number,
  crypto: Crypto,
): Promise<Uint8Array> {
  if (!/^\d{6}$/.test(pin)) throw new AppError("E_INVALID", "请输入六位 PIN");
  if (!crypto.subtle)
    throw new AppError("E_UNAVAILABLE", "请使用 HTTPS 或本机地址启用离线解锁");
  const key = await crypto.subtle.importKey(
    "raw",
    utf8Encode(pin) as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: salt as BufferSource,
        iterations,
      },
      key,
      256,
    ),
  );
}
export async function createPinVerifier(
  pin: string,
  crypto: Crypto,
): Promise<PinVerifier> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    salt: toHex(salt),
    hash: toHex(await derive(pin, salt, PIN_ITERATIONS, crypto)),
    iterations: PIN_ITERATIONS,
  };
}
export async function verifyPin(
  pin: string,
  verifier: PinVerifier,
  crypto: Crypto,
): Promise<boolean> {
  if (!/^\d{6}$/.test(pin)) return false;
  if (
    verifier.iterations !== PIN_ITERATIONS ||
    !/^[a-f0-9]{32}$/.test(verifier.salt) ||
    !/^[a-f0-9]{64}$/.test(verifier.hash)
  )
    throw new AppError("E_INTEGRITY", "本机解锁记录无效，请联网登录");
  return equals(
    await derive(pin, fromHex(verifier.salt), verifier.iterations, crypto),
    fromHex(verifier.hash),
  );
}
export function authMessage(error: unknown): string {
  if (!(error instanceof AppError)) return "暂时无法登录，请重试";
  switch (error.code) {
    case "E_UNAUTHENTICATED":
      return "PIN 不正确，请重试";
    case "E_RATE_LIMITED":
      return "尝试次数过多，请稍后再试";
    case "E_OFFLINE":
    case "E_DISCONNECTED":
      return "此账户尚未在本机登录，请联网后首次登录";
    case "E_DENIED":
      return "此设备或账户暂不可用，请联系管理员";
    default:
      return error.message;
  }
}
