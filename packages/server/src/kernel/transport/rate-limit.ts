import { AppError } from "@talos/base";
/** Per authenticated actor, shared across connections. Buckets expire and memory is bounded. */
export class ExpensiveCallLimiter {
  private readonly buckets = new Map<
    string,
    { count: number; until: number }
  >();
  constructor(private readonly now: () => number) {}
  check(actor: string, method: string): void {
    const limit =
      /^(media\.(search|resolve|prepare)|netbooks\.(search|download)|ai\.run\.start|library\.doc\.import(Text|File)|upload\.begin|ops\.(backup\.create|update\.(check|install))|admin\.incident\.(download|report|selfTest))$/.test(
        method,
      )
        ? 30
        : /^(upload\.(append|commit)|chat\.text\.put|ai\.text\.put)$/.test(
              method,
            )
          ? 1200
          : 0;
    if (!limit) return;
    const now = this.now();
    const key = `${actor}:${method}`;
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.until <= now) {
      for (const [id, value] of this.buckets)
        if (value.until <= now) this.buckets.delete(id);
      if (this.buckets.size >= 10000)
        throw new AppError("E_BUSY", "请求繁忙，请稍后重试");
      bucket = { count: 0, until: now + 60000 };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= limit)
      throw new AppError("E_BUSY", "请求过于频繁，请稍后重试", {
        retryAt: bucket.until,
      });
    bucket.count++;
  }
}
