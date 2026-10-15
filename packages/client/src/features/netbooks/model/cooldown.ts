export function remainingSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
/** Absolute deadline for a server-reported remaining wait; tolerates client/server clock skew. */
export function cooldownDeadline(
  now: number,
  retryAt: number,
  serverTime: number,
): number {
  return now + Math.max(0, retryAt - serverTime);
}
