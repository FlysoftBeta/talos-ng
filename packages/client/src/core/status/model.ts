/** A queued write to the server: waiting out its debounce, pending, in flight or rejected. */
export interface OutboundView {
  id: string;
  title: string;
  state: "waiting" | "pending" | "sending" | "failed";
  /** Earlier writes to the same value folded into this one. */
  merged: number;
  /** For `waiting`: epoch ms when the debounced write is sent at the latest. */
  dueAt?: number;
  error?: string;
  retry?: () => void;
  discard?: () => void;
}
/** One synchronisation scope; `ready` scopes are usable while the others still load. */
export interface ScopeView {
  id: string;
  title: string;
  state: "waiting" | "loading" | "ready";
  rows: number;
}
/** A file moving to or from the device: offline downloads and uploads. */
export interface TransferView {
  id: string;
  title: string;
  direction: "download" | "upload";
  progress: number;
  error?: string;
  retry?: () => void;
  cancel?: () => void;
}
/** What publishers pass to replace one transfer's current status. */
export interface TransferUpdate {
  title: string;
  progress: number;
  direction?: "download" | "upload";
  error?: string;
  retry?: () => void;
  cancel?: () => void;
}
export interface StatusViewModel {
  connection: "connected" | "connecting" | "offline" | "syncing";
  syncingCount?: number;
  lastSync: string;
  pending: number;
  failed: number;
  operations: readonly OutboundView[];
  scopes: readonly ScopeView[];
  transfers: readonly TransferView[];
  storage: string;
  build: string;
  update: {
    state: "none" | "installing" | "ready" | "applying" | "failed";
    progress?: number;
    message?: string;
    apply?: () => void;
  };
  /** The server refused this build: the user updates now or keeps working offline. */
  versionRejected?: { updateNow: () => void };
}
