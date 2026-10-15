import { cancelled } from "./cancellation.ts";
import type { CancellationSignal } from "./cancellation.ts";
declare function setTimeout(callback: () => void, delay: number): unknown;
declare function clearTimeout(handle: unknown): void;
export function sleep(ms: number, signal?: CancellationSignal): Promise<void> {
  if (!Number.isFinite(ms) || ms < 0 || ms > 2147483647)
    return Promise.reject(new RangeError("Invalid timer duration"));
  if (signal?.aborted) return Promise.reject(cancelled());
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
