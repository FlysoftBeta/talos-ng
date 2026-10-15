import type { ArgsOf, Method, ResultOf } from "@talos/contract";
import { failureText, opsCall, opsCapability } from "./port.ts";
import type { OpsPort } from "./port.ts";

export interface QueryState<T> {
  data: T | undefined;
  error: string | undefined;
}
export const emptyQuery = <T>(): QueryState<T> => ({
  data: undefined,
  error: undefined,
});

/**
 * One online query. Nothing is requested while the method is not permitted; a newer request
 * or a permission change makes every older response inert. Data is never persisted.
 */
export class OpsQuery<M extends Method> {
  private generation = 0;
  private allowed: boolean | undefined;
  state: QueryState<ResultOf<M>> = emptyQuery();
  constructor(
    private readonly port: OpsPort,
    readonly method: M,
    private readonly args: ArgsOf<M>,
    private readonly publish: (state: QueryState<ResultOf<M>>) => void,
  ) {}
  /** Loads on the first call and whenever the permission flips; clears data when it is lost. */
  sync(): void {
    const allowed = opsCapability(this.port, this.method).ok;
    if (allowed === this.allowed) return;
    this.allowed = allowed;
    if (allowed) this.reload();
    else {
      this.generation++;
      this.set(emptyQuery());
    }
  }
  reload = (): void => {
    if (!opsCapability(this.port, this.method).ok) return;
    const generation = ++this.generation;
    void opsCall(this.port, this.method, this.args)
      .then((data) => {
        if (generation === this.generation)
          this.set({ data, error: undefined });
      })
      .catch((failure: unknown) => {
        if (generation === this.generation)
          this.set({
            data: this.state.data,
            error: failureText(failure, "操作失败"),
          });
      });
  };
  cancel(): void {
    this.generation++;
    this.allowed = undefined;
  }
  private set(state: QueryState<ResultOf<M>>): void {
    this.state = state;
    this.publish(state);
  }
}

export type PanelStatus = "offline" | "error" | "loading" | "ready";

/** Which state a panel frame shows: permission first, then failure, then loading. */
export function panelStatus(
  access: { ok: true } | { ok: false; reason: string },
  error: string | undefined,
  loading: boolean,
): PanelStatus {
  return !access.ok
    ? "offline"
    : error
      ? "error"
      : loading
        ? "loading"
        : "ready";
}
