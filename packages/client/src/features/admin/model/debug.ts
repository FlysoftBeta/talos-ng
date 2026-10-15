import { StateStore } from "../../../core/controller-state.ts";
import type { RuntimeStatusPort } from "../../../core/runtime-port.ts";

export type DebugPort = Pick<
  RuntimeStatusPort,
  "isDebugOffline" | "setDebugOffline"
>;
export interface DebugState {
  offline: boolean;
}

/** Root-only per-client force-offline switch; it stays reachable to turn itself off. */
export class DebugController extends StateStore<DebugState> {
  constructor(private readonly port: DebugPort) {
    super({ offline: port.isDebugOffline() });
  }
  toggle = (): void => {
    const offline = !this.state.offline;
    this.port.setDebugOffline(offline);
    this.patch({ offline });
  };
}
