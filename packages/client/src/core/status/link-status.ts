import { AppError, Emitter } from "@talos/base";
import type { ClientState, LinkClient } from "@talos/link";
import type { StatusViewModel } from "./model.ts";

export type LinkConnection = Exclude<StatusViewModel["connection"], "syncing">;

/** A live carrier does not imply synchronization; sync progress belongs to its own model. */
export function toStatusConnection(state: ClientState): LinkConnection {
  const mapping: Record<ClientState, LinkConnection> = {
    idle: "offline",
    connecting: "connecting",
    open: "connected",
    waiting: "offline",
    versionMismatch: "offline",
    stopped: "offline",
  };
  return mapping[state];
}

/** Per-client connection projection with stable useSyncExternalStore-compatible methods. */
export class LinkConnectionStore {
  private snapshot: LinkConnection;
  private readonly changes = new Emitter<void>();
  private readonly detach: () => void;
  private disposed = false;

  constructor(client: Pick<LinkClient, "state" | "onState">) {
    this.snapshot = toStatusConnection(client.state);
    this.detach = client.onState((state) => {
      if (this.disposed) return;
      const snapshot = toStatusConnection(state);
      if (this.snapshot !== snapshot) {
        this.snapshot = snapshot;
        this.changes.emit(undefined);
      }
    });
    // Capture any synchronous state change while the adapter attached its listener.
    this.snapshot = toStatusConnection(client.state);
  }

  readonly getSnapshot = (): LinkConnection => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) throw new AppError("E_CANCELLED", "连接状态订阅已关闭");
    return this.changes.on(listener);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    this.changes.clear();
  }
}
