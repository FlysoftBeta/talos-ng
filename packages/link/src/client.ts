import { createClientFsm } from "./client-state.ts";
import type { ClientState } from "./client-state.ts";
import { AppError, backoff, deferred, Emitter } from "@talos/base";
import type { CancellationSignal, Deferred } from "@talos/base";
import type { Carrier } from "./carrier.ts";
import {
  decodeFrame,
  encodeFrame,
  frameLimit,
  protocolError,
} from "./codec.ts";
import type {
  Frame,
  FrameInput,
  HelloHeader,
  WelcomeHeader,
} from "./protocol.ts";
import { duration, systemTimers } from "./runtime.ts";
import type { Timers } from "./runtime.ts";

export type { ClientState } from "./client-state.ts";
export interface CallOptions {
  body?: Uint8Array;
  op?: string;
  timeoutMs?: number;
  signal?: CancellationSignal;
}
export interface CallResult<T = unknown> {
  data: T;
  body: Uint8Array;
}
export type Call = (
  method: string,
  args: unknown,
  options?: CallOptions,
) => Promise<CallResult>;
export interface LinkClientOptions {
  connect: () => Promise<Carrier>;
  hello: () => HelloHeader;
  timers?: Timers;
  clock?: () => number;
  random?: () => number;
  backoff?: { baseMs?: number; maxMs?: number; jitter?: number };
  connectTimeoutMs?: number;
  pingIntervalMs?: number;
  deadTimeoutMs?: number;
  maxFrameBytes?: number;
}
interface Pending {
  result: Deferred<CallResult>;
  timer?: unknown;
  off(): void;
}
interface Session {
  carrier: Carrier;
  off: (() => void)[];
  lastSeen: number;
  ping?: unknown;
  dead?: unknown;
}
export class LinkClient {
  private readonly fsm = createClientFsm();
  private readonly timers: Timers;
  private readonly clock: () => number;
  private readonly delays: ReturnType<typeof backoff>;
  private readonly maxFrameBytes: number;
  private readonly connectTimeout: number;
  private readonly pingInterval: number;
  private readonly deadTimeout: number;
  private readonly welcomes = new Emitter<WelcomeHeader>();
  private readonly versions = new Emitter<AppError>();
  private readonly topics = new Map<
    string,
    { emitter: Emitter<CallResult>; count: number }
  >();
  private readonly pending = new Map<number, Pending>();
  private session?: Session;
  private generation = 0;
  private nextId = 0;
  private connectTimer?: unknown;
  private retryTimer?: unknown;
  constructor(private readonly options: LinkClientOptions) {
    this.timers = options.timers ?? systemTimers;
    this.clock = options.clock ?? Date.now;
    this.maxFrameBytes = frameLimit(options);
    this.connectTimeout = duration(options.connectTimeoutMs ?? 8000);
    this.pingInterval = duration(options.pingIntervalMs ?? 20000);
    this.deadTimeout = duration(options.deadTimeoutMs ?? 45000);
    if (this.pingInterval === 0 || this.deadTimeout === 0)
      throw new AppError("E_INVALID", "无效的心跳间隔");
    try {
      this.delays = backoff({
        baseMs: options.backoff?.baseMs ?? 500,
        maxMs: options.backoff?.maxMs ?? 10000,
        jitter: options.backoff?.jitter ?? 0.2,
        random: options.random,
      });
    } catch {
      throw new AppError("E_INVALID", "无效的重连参数");
    }
  }
  get state(): ClientState {
    return this.fsm.state;
  }
  onState(fn: (state: ClientState) => void): () => void {
    return this.fsm.onTransition(({ to }) => fn(to));
  }
  onWelcome(fn: (welcome: WelcomeHeader) => void): () => void {
    return this.welcomes.on(fn);
  }
  onVersionMismatch(fn: (error: AppError) => void): () => void {
    return this.versions.on(fn);
  }
  on(topic: string, fn: (event: CallResult) => void): () => void {
    let entry = this.topics.get(topic);
    if (!entry) {
      entry = { emitter: new Emitter(), count: 0 };
      this.topics.set(topic, entry);
    }
    entry.count++;
    const off = entry.emitter.on((event) => fn(event));
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      off();
      if (--entry.count === 0) this.topics.delete(topic);
    };
  }

  start(): void {
    if (this.fsm.send("start") && this.state === "connecting") this.connect();
  }
  stop(): void {
    if (this.state === "stopped") return;
    this.cleanup(new AppError("E_DISCONNECTED", "连接已停止"));
    this.fsm.send("stop");
  }
  private connect(): void {
    const generation = ++this.generation;
    this.connectTimer = this.timers.setTimeout(
      () => this.lost(),
      this.connectTimeout,
    );
    void Promise.resolve()
      .then(() =>
        generation === this.generation ? this.options.connect() : undefined,
      )
      .then((carrier) => {
        if (!carrier) return;
        if (generation !== this.generation || this.state !== "connecting") {
          carrier.close();
          return;
        }
        const session: Session = { carrier, off: [], lastSeen: this.clock() };
        this.session = session;
        this.nextId = 0;
        session.off.push(
          carrier.onMessage((bytes) => {
            if (this.session === session) this.receive(bytes);
          }),
        );
        const offClose = carrier.onClose(() => {
          if (this.session === session) this.lost();
        });
        if (this.session !== session) {
          offClose();
          return;
        }
        session.off.push(offClose);
        this.send({ type: 1, header: this.options.hello() });
      })
      .catch(() => {
        if (generation === this.generation) this.lost();
      });
  }
  private send(frame: FrameInput): void {
    if (!this.session) throw new AppError("E_DISCONNECTED", "连接已断开");
    this.session.carrier.send(
      encodeFrame(frame, { maxFrameBytes: this.maxFrameBytes }),
    );
  }
  private receive(bytes: Uint8Array): void {
    let frame: Frame;
    try {
      frame = decodeFrame(bytes, { maxFrameBytes: this.maxFrameBytes });
    } catch {
      this.failProtocol();
      return;
    }
    const session = this.session!;
    session.lastSeen = this.clock();
    if (frame.type === 9) {
      const error = new AppError(
        frame.header.code,
        frame.header.message ?? "连接已关闭",
      );
      if (error.code === "E_VERSION") {
        this.cleanup(error);
        this.fsm.send("version");
        this.versions.emit(error);
      } else this.lost();
      return;
    }
    if (this.state === "connecting") {
      if (frame.type !== 2) {
        this.failProtocol();
        return;
      }
      if (frame.header.v !== 1) {
        const error = new AppError("E_VERSION", "版本不兼容");
        this.cleanup(error);
        this.fsm.send("version");
        this.versions.emit(error);
        return;
      }
      this.timers.clearTimeout(this.connectTimer);
      this.delays.reset();
      this.fsm.send("welcome");
      if (this.session !== session) return;
      this.schedulePing(session);
      this.scheduleDead(session);
      this.welcomes.emit(frame.header);
      return;
    }
    switch (frame.type) {
      case 4:
        if (frame.header.ok)
          this.settle(frame.header.id, {
            data: frame.header.d,
            body: frame.body,
          });
        else
          this.settle(
            frame.header.id,
            undefined,
            AppError.fromJSON(frame.header.e),
          );
        break;
      case 5:
        this.topics
          .get(frame.header.t)
          ?.emitter.emit({ data: frame.header.d, body: frame.body });
        break;
      case 6:
        try {
          this.send({ type: 7, header: frame.header });
        } catch {
          this.lost();
        }
        break;
      case 7:
        break;
      default:
        this.failProtocol();
    }
  }
  private failProtocol(): void {
    try {
      this.send({ type: 9, header: { code: "E_PROTOCOL" } });
    } catch {
      /* Loss is handled below. */
    }
    this.lost();
  }
  private schedulePing(session: Session): void {
    session.ping = this.timers.setTimeout(() => {
      if (this.session !== session) return;
      try {
        this.send({
          type: 6,
          header: { n: Math.max(0, Math.floor(this.clock())) },
        });
      } catch {
        this.lost();
        return;
      }
      this.schedulePing(session);
    }, this.pingInterval);
  }
  private scheduleDead(session: Session): void {
    session.dead = this.timers.setTimeout(
      () => {
        if (this.session !== session) return;
        if (this.clock() - session.lastSeen >= this.deadTimeout) this.lost();
        else this.scheduleDead(session);
      },
      Math.max(1, this.deadTimeout - (this.clock() - session.lastSeen)),
    );
  }
  private cleanup(error: AppError): void {
    ++this.generation;
    this.timers.clearTimeout(this.connectTimer);
    this.timers.clearTimeout(this.retryTimer);
    const session = this.session;
    this.session = undefined;
    if (session) {
      for (const off of session.off) off();
      this.timers.clearTimeout(session.ping);
      this.timers.clearTimeout(session.dead);
      try {
        session.carrier.close();
      } catch {
        /* Already disconnected. */
      }
    }
    for (const id of this.pending.keys()) this.settle(id, undefined, error);
  }
  private lost(): void {
    if (this.state !== "open" && this.state !== "connecting") return;
    this.cleanup(new AppError("E_DISCONNECTED", "连接已断开，操作结果未知"));
    this.fsm.send("lost");
    if (this.fsm.state !== "waiting") return;
    this.retryTimer = this.timers.setTimeout(() => {
      if (this.fsm.send("retry") && this.state === "connecting") this.connect();
    }, this.delays.next());
  }
  private settle(id: number, value?: CallResult, error?: AppError): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    this.timers.clearTimeout(pending.timer);
    pending.off();
    if (error) pending.result.reject(error);
    else pending.result.resolve(value!);
  }
  async call(
    method: string,
    args: unknown,
    options: CallOptions = {},
  ): Promise<CallResult> {
    if (this.state !== "open") throw new AppError("E_OFFLINE", "当前离线");
    if (options.signal?.aborted)
      throw new AppError("E_CANCELLED", "操作已取消");
    const timeout = duration(options.timeoutMs ?? 30000);
    if (!Number.isSafeInteger(this.nextId)) {
      this.lost();
      throw protocolError();
    }
    const id = this.nextId++;
    // Validate before registering or transmitting the call; malformed local data is not a disconnect.
    const bytes = encodeFrame(
      {
        type: 3,
        header: {
          id,
          m: method,
          a: args,
          ...(options.op === undefined ? {} : { op: options.op }),
        },
        body: options.body,
      },
      { maxFrameBytes: this.maxFrameBytes },
    );
    const result = deferred<CallResult>();
    const cancel = (code: "E_CANCELLED" | "E_TIMEOUT") => {
      if (!this.pending.has(id)) return;
      this.settle(
        id,
        undefined,
        new AppError(code, code === "E_TIMEOUT" ? "操作超时" : "操作已取消"),
      );
      try {
        this.send({ type: 8, header: { id } });
      } catch {
        this.lost();
      }
    };
    const abort = () => cancel("E_CANCELLED");
    const pending: Pending = {
      result,
      off: () => options.signal?.removeEventListener("abort", abort),
    };
    this.pending.set(id, pending);
    pending.timer = this.timers.setTimeout(() => cancel("E_TIMEOUT"), timeout);
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      this.session!.carrier.send(bytes);
    } catch {
      this.lost();
    }
    return result.promise;
  }
}
