import { AppError, createUlid, Emitter } from "@talos/base";
import type { CancellationSignal, ErrorCode } from "@talos/base";
import type { Carrier } from "./carrier.ts";
import {
  decodeFrame,
  encodeFrame,
  frameLimit,
  protocolError,
} from "./codec.ts";
import type {
  CallHeader,
  Frame,
  FrameInput,
  HelloHeader,
  WelcomeHeader,
} from "./protocol.ts";
import { abortController, duration, systemTimers } from "./runtime.ts";
import type { Timers } from "./runtime.ts";

export interface HandlerResult {
  data?: unknown;
  body?: Uint8Array;
}
export interface Connection<Info = unknown, Context = unknown> {
  readonly id: string;
  readonly info: Info;
  readonly device: string | null;
  readonly ctx: Map<string, Context>;
  emit(topic: string, data: unknown, body?: Uint8Array): void;
  close(code?: ErrorCode, message?: string): void;
}
export type Handler<Info = unknown, Context = unknown> = (
  connection: Connection<Info, Context>,
  args: unknown,
  body: Uint8Array,
  signal: CancellationSignal,
) => HandlerResult | Promise<HandlerResult>;
export interface CallContext<Info = unknown, Context = unknown> {
  connection: Connection<Info, Context>;
  method: string;
  args: unknown;
  body: Uint8Array;
  op?: string;
  signal: CancellationSignal;
}
export interface LinkServerOptions<Info = unknown, Context = unknown> {
  acceptHello(hello: HelloHeader, info: Info): WelcomeHeader | AppError;
  reportIncident(
    error: unknown,
    context: { connection: Connection<Info, Context>; method?: string },
  ): string;
  middleware?(
    context: CallContext<Info, Context>,
    next: () => Promise<HandlerResult>,
  ): HandlerResult | Promise<HandlerResult>;
  timers?: Timers;
  clock?: () => number;
  random?: () => number;
  helloTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxInFlight?: number;
  maxFrameBytes?: number;
}
interface Session<Info, Context> {
  connection: Connection<Info, Context>;
  carrier: Carrier;
  ready: boolean;
  closed: boolean;
  calls: Map<number, ReturnType<typeof abortController>>;
  off: (() => void)[];
  helloTimer?: unknown;
  idleTimer?: unknown;
  lastSeen: number;
  identify(welcome: WelcomeHeader): void;
}
export class LinkServer<Info = unknown, Context = unknown> {
  private readonly handlers = new Map<string, Handler<Info, Context>>();
  private readonly active = new Map<string, Connection<Info, Context>>();
  private readonly sessions = new Set<Session<Info, Context>>();
  private readonly connected = new Emitter<Connection<Info, Context>>();
  private readonly disconnected = new Emitter<Connection<Info, Context>>();
  private readonly timers: Timers;
  private readonly clock: () => number;
  private readonly ids: ReturnType<typeof createUlid>;
  private readonly maxFrameBytes: number;
  private readonly helloTimeout: number;
  private readonly idleTimeout: number;
  private readonly maxInFlight: number;
  private closed = false;
  constructor(private readonly options: LinkServerOptions<Info, Context>) {
    this.timers = options.timers ?? systemTimers;
    this.clock = options.clock ?? Date.now;
    this.ids = createUlid({ clock: this.clock, random: options.random });
    this.maxFrameBytes = frameLimit(options);
    this.helloTimeout = duration(options.helloTimeoutMs ?? 5000);
    this.idleTimeout = duration(options.idleTimeoutMs ?? 45000);
    this.maxInFlight = options.maxInFlight ?? 16;
    if (
      this.idleTimeout === 0 ||
      !Number.isSafeInteger(this.maxInFlight) ||
      this.maxInFlight < 1
    )
      throw new AppError("E_INVALID", "无效的连接限制");
  }
  get connections(): ReadonlyMap<string, Connection<Info, Context>> {
    return this.active;
  }
  onConnection(
    fn: (connection: Connection<Info, Context>) => void,
  ): () => void {
    return this.connected.on(fn);
  }
  onDisconnect(
    fn: (connection: Connection<Info, Context>) => void,
  ): () => void {
    return this.disconnected.on(fn);
  }
  register(method: string, handler: Handler<Info, Context>): () => void {
    if (!method || this.handlers.has(method))
      throw new AppError("E_INVALID", "方法为空或已注册");
    this.handlers.set(method, handler);
    return () => {
      if (this.handlers.get(method) === handler) this.handlers.delete(method);
    };
  }
  accept(carrier: Carrier, info: Info): Connection<Info, Context> {
    let id = this.ids();
    let device: string | null = null;
    const connection: Connection<Info, Context> = {
      get id() {
        return id;
      },
      info,
      get device() {
        return device;
      },
      ctx: new Map(),
      emit: (topic, data, body) => {
        if (!session.ready || session.closed)
          throw new AppError("E_OFFLINE", "连接尚未就绪");
        this.send(session, { type: 5, header: { t: topic, d: data }, body });
      },
      close: (code = "E_DISCONNECTED", message) =>
        this.closeSession(session, code, message),
    };
    const session: Session<Info, Context> = {
      connection,
      carrier,
      ready: false,
      closed: false,
      calls: new Map(),
      off: [],
      lastSeen: this.clock(),
      identify: (welcome) => {
        id = welcome.conn;
        device = welcome.device;
      },
    };
    this.sessions.add(session);
    if (this.closed) {
      this.closeSession(session, "E_UNAVAILABLE");
      return connection;
    }
    session.helloTimer = this.timers.setTimeout(
      () => this.closeSession(session, "E_PROTOCOL", "握手超时"),
      this.helloTimeout,
    );
    session.off.push(
      carrier.onMessage((bytes) => {
        if (!session.closed) this.receive(session, bytes);
      }),
    );
    const offClose = carrier.onClose(() => this.finish(session));
    if (session.closed) offClose();
    else session.off.push(offClose);
    return connection;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const session of this.sessions)
      this.closeSession(session, "E_UNAVAILABLE", "服务已关闭");
  }
  private send(session: Session<Info, Context>, frame: FrameInput): void {
    const bytes = encodeFrame(frame, { maxFrameBytes: this.maxFrameBytes });
    try {
      session.carrier.send(bytes);
    } catch {
      this.finish(session);
      try {
        session.carrier.close();
      } catch {
        /* Already closed. */
      }
      throw new AppError("E_DISCONNECTED", "连接已断开");
    }
  }
  private finish(session: Session<Info, Context>): void {
    if (session.closed) return;
    session.closed = true;
    for (const off of session.off) off();
    this.timers.clearTimeout(session.helloTimer);
    this.timers.clearTimeout(session.idleTimer);
    this.sessions.delete(session);
    for (const controller of session.calls.values()) controller.abort();
    session.calls.clear();
    if (session.ready) {
      this.active.delete(session.connection.id);
      this.disconnected.emit(session.connection);
    }
  }
  private closeSession(
    session: Session<Info, Context>,
    code: ErrorCode,
    message?: string,
  ): void {
    if (session.closed) return;
    try {
      this.send(session, {
        type: 9,
        header: { code, ...(message === undefined ? {} : { message }) },
      });
    } catch {
      /* Best effort before carrier closure. */
    }
    this.finish(session);
    try {
      session.carrier.close(1000, code);
    } catch {
      /* Already closed. */
    }
  }
  private idle(session: Session<Info, Context>): void {
    session.idleTimer = this.timers.setTimeout(
      () => {
        if (session.closed) return;
        if (this.clock() - session.lastSeen >= this.idleTimeout)
          this.closeSession(session, "E_TIMEOUT", "连接空闲超时");
        else this.idle(session);
      },
      Math.max(1, this.idleTimeout - (this.clock() - session.lastSeen)),
    );
  }
  private incident(
    error: unknown,
    session: Session<Info, Context>,
    method?: string,
  ): AppError {
    let incidentId: string | undefined;
    try {
      incidentId = this.options.reportIncident(error, {
        connection: session.connection,
        method,
      });
    } catch {
      /* Reporting cannot leak errors or break the transport. */
    }
    return new AppError(
      "E_INTERNAL",
      "服务内部错误",
      incidentId === undefined ? undefined : { incidentId },
    );
  }
  private receive(session: Session<Info, Context>, bytes: Uint8Array): void {
    try {
      const frame = decodeFrame(bytes, { maxFrameBytes: this.maxFrameBytes });
      session.lastSeen = this.clock();
      if (!session.ready) {
        if (frame.type !== 1) throw protocolError();
        if (frame.header.v !== 1) {
          this.closeSession(session, "E_VERSION", "版本不兼容");
          return;
        }
        let welcome: WelcomeHeader | AppError;
        try {
          welcome = this.options.acceptHello(
            frame.header,
            session.connection.info,
          );
        } catch (error) {
          welcome =
            error instanceof AppError ? error : this.incident(error, session);
        }
        if (welcome instanceof AppError) {
          this.closeSession(session, welcome.code, welcome.message);
          return;
        }
        if (welcome.v !== 1 || this.active.has(welcome.conn))
          throw protocolError();
        // Validate and send before publishing the connection.
        this.send(session, { type: 2, header: welcome });
        session.identify(welcome);
        session.ready = true;
        this.timers.clearTimeout(session.helloTimer);
        this.active.set(session.connection.id, session.connection);
        this.idle(session);
        this.connected.emit(session.connection);
        return;
      }
      this.dispatch(session, frame);
    } catch {
      this.closeSession(session, "E_PROTOCOL");
    }
  }
  private dispatch(session: Session<Info, Context>, frame: Frame): void {
    switch (frame.type) {
      case 3:
        if (session.calls.has(frame.header.id)) throw protocolError();
        if (session.calls.size >= this.maxInFlight) {
          this.send(session, {
            type: 4,
            header: {
              id: frame.header.id,
              ok: false,
              e: new AppError("E_BUSY", "请求过多，请稍后重试").toJSON(),
            },
          });
        } else void this.runCall(session, frame.header, frame.body);
        break;
      case 8:
        session.calls.get(frame.header.id)?.abort();
        break;
      case 6:
        this.send(session, { type: 7, header: frame.header });
        break;
      case 7:
        break;
      case 9:
        this.finish(session);
        session.carrier.close();
        break;
      default:
        throw protocolError();
    }
  }
  private async runCall(
    session: Session<Info, Context>,
    header: CallHeader,
    body: Uint8Array,
  ): Promise<void> {
    const controller = abortController();
    session.calls.set(header.id, controller);
    try {
      const invoke = async (): Promise<HandlerResult> => {
        const handler = this.handlers.get(header.m);
        if (!handler) throw new AppError("E_NOT_FOUND", "方法不存在");
        return handler(session.connection, header.a, body, controller.signal);
      };
      const context: CallContext<Info, Context> = {
        connection: session.connection,
        method: header.m,
        args: header.a,
        body,
        op: header.op,
        signal: controller.signal,
      };
      const result = await (this.options.middleware
        ? this.options.middleware(context, invoke)
        : invoke());
      if (!session.closed && !controller.signal.aborted)
        this.send(session, {
          type: 4,
          header: { id: header.id, ok: true, d: result.data ?? null },
          body: result.body,
        });
    } catch (error) {
      const appError =
        error instanceof AppError
          ? error
          : this.incident(error, session, header.m);
      if (!session.closed && !controller.signal.aborted) {
        try {
          this.send(session, {
            type: 4,
            header: { id: header.id, ok: false, e: appError.toJSON() },
          });
        } catch {
          this.closeSession(session, "E_PROTOCOL");
        }
      }
    } finally {
      session.calls.delete(header.id);
    }
  }
}
