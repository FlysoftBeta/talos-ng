import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}
export function checkPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  return timingSafeEqual(
    scryptSync(password, salt, 32),
    Buffer.from(hash, "hex"),
  );
}
