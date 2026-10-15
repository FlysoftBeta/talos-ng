import { AppError } from "@talos/base";
import type { Carrier, LinkClientOptions } from "@talos/link";
import { LinkClient } from "@talos/link";

export function websocketCarrier(url: string): Promise<Carrier> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    socket.onerror = () => reject(new AppError("E_OFFLINE", "无法连接服务器"));
    socket.onopen = () => {
      resolve({
        send: (bytes) => {
          if (socket.readyState !== WebSocket.OPEN)
            throw new AppError("E_DISCONNECTED", "连接已断开");
          socket.send(bytes as BufferSource);
        },
        close: () => socket.close(),
        onMessage: (listener) => {
          const fn = (event: MessageEvent<unknown>): void => {
            if (event.data instanceof ArrayBuffer)
              listener(new Uint8Array(event.data));
            else socket.close(1003, "Binary frames required");
          };
          socket.addEventListener("message", fn);
          return () => socket.removeEventListener("message", fn);
        },
        onClose: (listener) => {
          const fn = (event: CloseEvent): void =>
            listener({ code: event.code, reason: event.reason });
          socket.addEventListener("close", fn);
          return () => socket.removeEventListener("close", fn);
        },
      });
    };
    socket.onclose = () => reject(new AppError("E_OFFLINE", "无法连接服务器"));
  });
}
export class AppLink extends LinkClient {
  private interruptCarrier: () => void;
  constructor(
    build: string,
    device: () => string | undefined,
    options: Partial<LinkClientOptions> = {},
  ) {
    let active: Carrier | undefined;
    const connect =
      options.connect ??
      (() =>
        websocketCarrier(
          `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/link`,
        ));
    super({
      hello: () => ({ v: 1, build, device: device() ?? null, lang: "zh-CN" }),
      ...options,
      connect: async () => {
        if (typeof navigator !== "undefined" && navigator.onLine === false)
          throw new AppError("E_OFFLINE", "当前离线");
        active = await connect();
        return active;
      },
    });
    this.interruptCarrier = () => active?.close();
  }
  /** Network loss is recoverable; LinkClient.stop is reserved for permanent disposal. */
  interrupt(): void {
    this.interruptCarrier();
  }
}
export function createAppLink(
  build: string,
  device: () => string | undefined,
  options: Partial<LinkClientOptions> = {},
): AppLink {
  return new AppLink(build, device, options);
}
