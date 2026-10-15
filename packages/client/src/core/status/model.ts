export interface StatusViewModel {
  connection: "connected" | "connecting" | "offline" | "syncing";
  syncingCount?: number;
  lastSync: string;
  pending: number;
  failed: number;
  operations: readonly {
    id: string;
    title: string;
    state: "pending" | "failed";
    retry?: () => void;
    discard?: () => void;
  }[];
  downloads: readonly { id: string; title: string; progress: number }[];
  storage: string;
  build: string;
  update: {
    state: "none" | "installing" | "ready" | "applying" | "failed";
    progress?: number;
    message?: string;
    apply?: () => void;
  };
}
