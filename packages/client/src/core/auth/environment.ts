/** Session effects supplied by the host; policy stays in the auth controller. */
export interface SessionEnvironment {
  readonly crypto: Crypto;
  readonly timers: {
    set(fn: () => void, ms: number): unknown;
    clear(id: unknown): void;
  };
  online(): boolean;
  persist(): void;
  activity(listener: () => void): () => void;
}
