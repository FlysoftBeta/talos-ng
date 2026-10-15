import { AppError } from "@talos/base";
export type AdmissionReason =
  | "whitelist-required"
  | "bound-to-other-user"
  | "banned"
  | "throttled"
  | "invalid-client"
  | "system-lock"
  | "idle-lock";
export interface Admission {
  reason: AdmissionReason;
  retryAt?: number;
}
const reasons: readonly string[] = [
  "whitelist-required",
  "bound-to-other-user",
  "banned",
  "throttled",
  "invalid-client",
  "system-lock",
  "idle-lock",
];
export function admissionFrom(
  error: unknown,
  fallbackRetryAt?: number,
): Admission | undefined {
  if (!(error instanceof AppError)) return undefined;
  const data = error.data as { reason?: string; retryAt?: number } | undefined;
  if (data?.reason && reasons.includes(data.reason))
    return { reason: data.reason as AdmissionReason, retryAt: data.retryAt };
  if (error.code === "E_RATE_LIMITED")
    return { reason: "throttled", retryAt: fallbackRetryAt };
  if (error.code === "E_LOCKED") return { reason: "system-lock" };
  return undefined;
}
