import {
  browserWebSocketCarrier,
  connectBrowserWebSocket,
} from "@talos/link/ws-browser";
import type { BrowserSocket } from "@talos/link/ws-browser";
import type { Carrier } from "@talos/link";
// Compile-only regression: the minimal isomorphic declarations must accept a
// native DOM WebSocket, including modern TypeScript's BufferSource generics.
export function wrapNativeSocket(socket: WebSocket): Carrier {
  const compatible: BrowserSocket = socket;
  return browserWebSocketCarrier(compatible);
}
export function connectNativeSocket(url: string): Promise<Carrier> {
  return connectBrowserWebSocket(url, (address) => new WebSocket(address));
}
