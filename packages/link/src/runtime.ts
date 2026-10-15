import { AppError } from "@talos/base";
import type { CancellationSignal } from "@talos/base";
declare function setTimeout(callback: () => void, delay: number): unknown;
declare function clearTimeout(handle: unknown): void;
declare const AbortController: {
  new (): { signal: CancellationSignal; abort(): void };
};
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export const systemTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};
export function abortController(): {
  signal: CancellationSignal;
  abort(): void;
} {
  return new AbortController();
}
export function duration(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0 || ms > 2147483647)
    throw new AppError("E_INVALID", "无效的超时时间");
  return ms;
}
