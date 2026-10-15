import { AppError, Emitter } from "@talos/base";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import type { Carrier, CarrierClose } from "../carrier.ts";
import { frameLimit } from "../codec.ts";
import { duration } from "../runtime.ts";
// This is the sole Node-specific entry point; the isomorphic index never imports it.
// eslint-disable-next-line boundaries/imports
import type { Server as HttpServer, IncomingMessage } from "node:http";
// eslint-disable-next-line boundaries/imports
import type { Server as HttpsServer } from "node:https";
// eslint-disable-next-line boundaries/imports
import type { Duplex } from "node:stream";

export interface NodeCarrier extends Carrier {
  readonly remoteAddress?: string;
}
export function nodeWebSocketCarrier(
  socket: WebSocket,
  remoteAddress?: string,
): NodeCarrier {
  const messages = new Emitter<Uint8Array>();
  const closes = new Emitter<CarrierClose>();
  let closed: CarrierClose | undefined;
  const finish = (event: CarrierClose) => {
    if (closed) return;
    closed = event;
    socket.off("message", message);
    socket.off("close", close);
    // Retain the error sink until the socket actually closes: terminate may emit an error.
    closes.emit(event);
    messages.clear();
    closes.clear();
  };
  const error = () => {
    finish({ code: 1006, reason: "WebSocket error" });
    socket.terminate();
  };
  const close = (code: number, reason: Buffer) => {
    finish({ code, reason: reason.toString() });
  };
  const message = (data: RawData, isBinary: boolean) => {
    if (!isBinary) {
      socket.close(1003, "Binary messages required");
      return;
    }
    if (data instanceof ArrayBuffer) messages.emit(new Uint8Array(data));
    else {
      const buffer = Array.isArray(data) ? Buffer.concat(data) : data;
      messages.emit(
        new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
      );
    }
  };
  socket.on("message", message);
  socket.on("close", close);
  socket.on("error", error);
  socket.once("close", () => socket.off("error", error));
  if (socket.readyState >= WebSocket.CLOSING)
    finish({ code: 1006, reason: "WebSocket closed" });
  return {
    remoteAddress,
    send(bytes) {
      if (closed || socket.readyState !== WebSocket.OPEN)
        throw new AppError("E_DISCONNECTED", "连接已断开");
      try {
        socket.send(bytes, { binary: true }, (err) => {
          if (err) error();
        });
      } catch {
        error();
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
export interface NodeWebSocketOptions {
  maxFrameBytes?: number;
  handshakeTimeoutMs?: number;
}
export function connectNodeWebSocket(
  url: string,
  options: NodeWebSocketOptions = {},
): Promise<NodeCarrier> {
  return new Promise((resolve, reject) => {
    const maxPayload = frameLimit(options);
    const handshakeTimeout = duration(options.handshakeTimeoutMs ?? 8000);
    let socket: WebSocket;
    try {
      socket = new WebSocket(url, {
        perMessageDeflate: false,
        maxPayload,
        handshakeTimeout,
      });
    } catch {
      reject(new AppError("E_DISCONNECTED", "无法连接服务器"));
      return;
    }
    const fail = () => {
      reject(new AppError("E_DISCONNECTED", "无法连接服务器"));
    };
    socket.on("error", fail);
    socket.once("close", fail);
    socket.once("open", () => {
      socket.off("error", fail);
      socket.off("close", fail);
      resolve(nodeWebSocketCarrier(socket));
    });
  });
}
export interface WebSocketListenerOptions extends NodeWebSocketOptions {
  server: HttpServer | HttpsServer;
  path: string;
  onConnection(
    carrier: NodeCarrier,
    info: { remoteAddress?: string; request: IncomingMessage },
  ): void;
}
/** Owns only matching upgrades; unmatched paths remain available to other upgrade handlers. */
export function attachWebSocketServer(options: WebSocketListenerOptions): {
  close(): Promise<void>;
} {
  if (!options.path.startsWith("/"))
    throw new AppError("E_INVALID", "无效的 WebSocket 路径");
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: frameLimit(options),
  });
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (request.url?.split("?")[0] !== options.path) return;
    wss.handleUpgrade(request, socket, head, (ws) => {
      const remoteAddress = request.socket.remoteAddress;
      const carrier = nodeWebSocketCarrier(ws, remoteAddress);
      try {
        options.onConnection(carrier, { remoteAddress, request });
      } catch {
        ws.terminate();
      }
    });
  };
  options.server.on("upgrade", upgrade);
  let closing: Promise<void> | undefined;
  return {
    close() {
      if (!closing) {
        options.server.off("upgrade", upgrade);
        closing = new Promise<void>((resolve, reject) => {
          for (const socket of wss.clients) socket.terminate();
          wss.close((error) =>
            error
              ? reject(new AppError("E_INTERNAL", "无法关闭 WebSocket 服务"))
              : resolve(),
          );
        });
      }
      return closing;
    },
  };
}
