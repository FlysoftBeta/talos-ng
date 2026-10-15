import { Semaphore } from "@talos/base";

// Only pending/active operations retain a lock; idle keys do not accumulate.
export class KeyLocks {
  private readonly locks = new Map<
    string,
    { semaphore: Semaphore; users: number }
  >();
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let entry = this.locks.get(key);
    if (!entry) {
      entry = { semaphore: new Semaphore(1), users: 0 };
      this.locks.set(key, entry);
    }
    entry.users++;
    try {
      return await entry.semaphore.run(fn);
    } finally {
      if (--entry.users === 0) this.locks.delete(key);
    }
  }
}
