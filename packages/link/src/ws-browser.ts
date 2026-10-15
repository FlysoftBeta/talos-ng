import { AppError, Emitter } from "@talos/base";
import type { Carrier, CarrierClose } from "./carrier.ts";
import { duration, systemTimers } from "./runtime.ts";
import type { Timers } from "./runtime.ts";
/** Minimal Chrome 70 WebSocket surface, structurally compatible with the DOM type. */
export interface BrowserSocket {
  binaryType: string;
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(bytes: Uint8Array<ArrayBuffer>): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  addEventListener(
    type: "close",
    listener: (event: { code: number; reason: string }) => void,
  ): void;
  addEventListener(type: "open" | "error", listener: () => void): void;
  removeEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  removeEventListener(
    type: "close",
    listener: (event: { code: number; reason: string }) => void,
  ): void;
  removeEventListener(type: "open" | "error", listener: () => void): void;
}
declare const WebSocket: { new (url: string): BrowserSocket };
export function browserWebSocketCarrier(socket: BrowserSocket): Carrier {
  const messages = new Emitter<Uint8Array>();
  const closes = new Emitter<CarrierClose>();
  let closed: CarrierClose | undefined;
  socket.binaryType = "arraybuffer";
  const message = (event: { data: unknown }) => {
    if (event.data instanceof ArrayBuffer)
      messages.emit(new Uint8Array(event.data));
    else socket.close(1003, "Binary messages required");
  };
  const close = (event: CarrierClose) => {
    if (closed) return;
    closed = event;
    socket.removeEventListener("message", message);
    socket.removeEventListener("close", close);
    socket.removeEventListener("error", error);
    closes.emit(event);
    messages.clear();
    closes.clear();
  };
  const error = () => {
    close({ code: 1006, reason: "WebSocket error" });
    socket.close();
  };
  socket.addEventListener("message", message);
  socket.addEventListener("close", close);
  socket.addEventListener("error", error);
  if (socket.readyState >= 2) close({ code: 1006, reason: "WebSocket closed" });
  return {
    send(bytes) {
      if (closed || socket.readyState !== 1)
        throw new AppError("E_DISCONNECTED", "连接已断开");
      try {
        // DOM BufferSource excludes SharedArrayBuffer. Preserve normal views,
        // copying only shared-backed input when a caller supplies it.
        socket.send(
          bytes.buffer instanceof ArrayBuffer
            ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            : new Uint8Array(bytes),
        );
      } catch {
        throw new AppError("E_DISCONNECTED", "连接已断开");
      }
    },
    close: (code, reason) => socket.close(code, reason),
    onMessage: (fn) => messages.on(fn),
    onClose(fn) {
      if (closed) {
        fn(closed);
        return () => {};
      }
      return closes.on(fn);
    },
    get bufferedAmount() {
      return socket.bufferedAmount;
    },
  };
}
export interface BrowserConnectOptions {
  timers?: Timers;
  timeoutMs?: number;
}
export function connectBrowserWebSocket(
  url: string,
  create: (url: string) => BrowserSocket = (address) => new WebSocket(address),
  options: BrowserConnectOptions = {},
): Promise<Carrier> {
  return new Promise((resolve, reject) => {
    const timeout = duration(options.timeoutMs ?? 8000);
    const timers = options.timers ?? systemTimers;
    let socket: BrowserSocket;
    try {
      socket = create(url);
    } catch {
      reject(new AppError("E_DISCONNECTED", "无法连接服务器"));
      return;
    }
    socket.binaryType = "arraybuffer";
    const cleanup = () => {
      timers.clearTimeout(timer);
      socket.removeEventListener("open", open);
      socket.removeEventListener("error", fail);
      socket.removeEventListener("close", fail);
    };
    const open = () => {
      cleanup();
      resolve(browserWebSocketCarrier(socket));
    };
    const fail = () => {
      cleanup();
      try {
        socket.close();
      } catch {
        /* No open connection to close. */
      }
      reject(new AppError("E_DISCONNECTED", "无法连接服务器"));
    };
    const timer = timers.setTimeout(fail, timeout);
    socket.addEventListener("open", open);
    socket.addEventListener("error", fail);
    socket.addEventListener("close", fail);
    if (socket.readyState === 1) open();
    else if (socket.readyState >= 2) fail();
  });
}
