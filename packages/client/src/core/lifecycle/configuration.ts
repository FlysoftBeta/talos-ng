import type { LinkClient } from "@talos/link";
import type { SessionEnvironment } from "../auth/environment.ts";
/** Resolved composition inputs. Core has no build globals or concrete transport factory. */
export interface RuntimeConfiguration {
  build: string;
  production: boolean;
  now?: () => number;
  random?: () => number;
  link: (device: () => string | undefined) => LinkClient;
  crypto?: Crypto;
  timers?: SessionEnvironment["timers"];
}
