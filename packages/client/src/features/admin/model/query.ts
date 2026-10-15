import type { ArgsOf, Method, ResultOf } from "@talos/contract";
import type { RuntimeCommandPort } from "../../../core/runtime-port.ts";

/** Online admin calls and capability checks; no admin response is ever cached or persisted. */
export type AdminCommandPort = Pick<RuntimeCommandPort, "can" | "command">;

export async function adminCall<M extends Method>(
  port: Pick<RuntimeCommandPort, "command">,
  method: M,
  args: ArgsOf<M>,
): Promise<ResultOf<M>> {
  const result = await port.command(method, args);
  return method.result.parse(result) as ResultOf<M>;
}

export function failureText(failure: unknown, fallback: string): string {
  return failure instanceof Error ? failure.message : fallback;
}

export const PAGE_SIZE = 50;

export interface LoadState<T> {
  data: T | undefined;
  loading: boolean;
  error: string;
}
export const loadingState = <T>(): LoadState<T> => ({
  data: undefined,
  loading: true,
  error: "",
});
export const idleState = <T>(data?: T): LoadState<T> => ({
  data,
  loading: false,
  error: "",
});

/**
 * One online query kept in controller memory. A newer `run` or `cancel` makes every older
 * response inert, so late answers never overwrite the current request.
 */
export class QueryResource<T> {
  private generation = 0;
  private loader: (() => Promise<T>) | undefined;
  constructor(
    private readonly publish: (state: LoadState<T>) => void,
    public state: LoadState<T> = loadingState<T>(),
  ) {}
  run(loader: () => Promise<T>): void {
    const generation = ++this.generation;
    this.loader = loader;
    this.set({ ...this.state, loading: true, error: "" });
    void loader()
      .then((data) => {
        if (generation === this.generation)
          this.set({ data, loading: false, error: "" });
      })
      .catch((failure: unknown) => {
        if (generation === this.generation)
          this.set({
            ...this.state,
            loading: false,
            error: failureText(failure, "加载失败，请重试"),
          });
      });
  }
  /** Repeats the last request, if any. */
  reload = (): void => {
    if (this.loader) this.run(this.loader);
  };
  /** Drops any pending response and shows `data` without a request. */
  settle(data?: T): void {
    this.generation++;
    this.loader = undefined;
    this.set(idleState(data));
  }
  cancel(): void {
    this.generation++;
  }
  private set(state: LoadState<T>): void {
    this.state = state;
    this.publish(state);
  }
}

/** Structural comparison for small capability/access snapshots. */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
