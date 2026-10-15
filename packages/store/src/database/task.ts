import { AppError } from "@talos/base";

/** Synchronous continuations execute in the IDB request event, never a microtask. */
export class TxTask<T> implements PromiseLike<T> {
  private state: "pending" | "fulfilled" | "rejected" = "pending";
  private value!: T;
  private error: unknown;
  private listeners: (() => void)[] = [];
  constructor(private readonly fail: (error: unknown) => void) {}
  resolve(value: T): void {
    if (this.state !== "pending") return;
    this.state = "fulfilled";
    this.value = value;
    this.flush();
  }
  reject(error: unknown): void {
    if (this.state !== "pending") return;
    this.state = "rejected";
    this.error = error;
    this.flush();
  }
  private flush(): void {
    for (const fn of this.listeners.splice(0)) fn();
  }
  then<A = T, B = never>(
    ok?: ((value: T) => A | PromiseLike<A>) | null,
    bad?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): TxTask<A | B> {
    const next = new TxTask<A | B>(this.fail);
    const run = (): void => {
      try {
        if (this.state === "rejected" && !bad) {
          next.reject(this.error);
          return;
        }
        const result =
          this.state === "fulfilled"
            ? ok
              ? ok(this.value)
              : (this.value as unknown as A)
            : bad!(this.error);
        if (result instanceof TxTask)
          result.then(
            (v) => next.resolve(v),
            (e) => next.reject(e),
          );
        else if (isThenable(result)) {
          // Consume rejected async callbacks without allowing them into the transaction.
          void Promise.resolve(result).catch(() => undefined);
          throw new AppError(
            "E_INVALID",
            "Non-IDB promises are forbidden inside transactions",
          );
        } else next.resolve(result);
      } catch (error) {
        next.reject(error);
        this.fail(error);
      }
    };
    if (this.state === "pending") this.listeners.push(run);
    else run();
    return next;
  }
}
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
