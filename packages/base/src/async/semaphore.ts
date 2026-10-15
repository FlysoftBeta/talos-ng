import { cancelled } from "./cancellation.ts";
import type { CancellationSignal } from "./cancellation.ts";
import { deferred } from "./deferred.ts";
import type { Deferred } from "./deferred.ts";

interface Waiter {
  ready: Deferred<void>;
  signal?: CancellationSignal;
  abort: () => void;
}
export class Semaphore {
  private active = 0;
  private readonly queue: Waiter[] = [];
  constructor(readonly capacity: number = 1) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new RangeError("Semaphore capacity must be positive");
  }
  acquire(signal?: CancellationSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(cancelled());
    if (this.active < this.capacity) {
      this.active++;
      return Promise.resolve();
    }
    const ready = deferred<void>();
    const waiter: Waiter = {
      ready,
      signal,
      abort: () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) {
          this.queue.splice(index, 1);
          signal?.removeEventListener("abort", waiter.abort);
          ready.reject(cancelled());
        }
      },
    };
    this.queue.push(waiter);
    signal?.addEventListener("abort", waiter.abort, { once: true });
    return ready.promise;
  }
  release(): void {
    if (this.active === 0)
      throw new Error("Semaphore released without acquisition");
    const waiter = this.queue.shift();
    if (waiter) {
      waiter.signal?.removeEventListener("abort", waiter.abort);
      waiter.ready.resolve();
    } else this.active--;
  }
  async run<T>(
    fn: () => T | PromiseLike<T>,
    signal?: CancellationSignal,
  ): Promise<T> {
    await this.acquire(signal);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
