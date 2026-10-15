import type { Database } from "@talos/store";
import type { LinkClient } from "@talos/link";
export interface RuntimeOptions {
  build?: string;
  production?: boolean;
  now?: () => number;
  random?: () => number;
  db?: () => Promise<Database>;
  link?: (device: () => string | undefined) => LinkClient;
  crypto?: Crypto;
  reload?: () => void;
  resetDatabase?: (device: string | undefined) => Promise<void>;
  timers?: {
    set(fn: () => void, ms: number): unknown;
    clear(id: unknown): void;
  };
}
