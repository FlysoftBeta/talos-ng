import { AppError, createUlid, deferred } from "@talos/base";
import type { CancellationSignal } from "@talos/base";
import type { ArgsOf, Method, ResultOf } from "@talos/contract";
import { OP_RETENTION_MS, contract } from "@talos/contract";
import { LinkServer } from "@talos/link";
import type { CallContext, Connection, HandlerResult } from "@talos/link";
import { migrate } from "../persistence/db.ts";
import { OpResults } from "../persistence/op-results.ts";
import type { Db } from "../persistence/db.ts";
import type { Uow } from "../persistence/uow.ts";
import { systemClock } from "../config/clock.ts";
import type { Clock } from "../config/clock.ts";
export interface RequestContext {
  readonly connection: Connection;
  afterReply(effect: () => void): void;
  readonly op?: string;
  readonly user?: string;
  readonly device?: string;
}
export interface LinkHostOptions {
  db: Db;
  uow: Uow;
  build: string;
  clock?: Clock;
  authenticate(connection: Connection): { user?: string; device?: string };
  reportIncident(error: unknown, context?: { method?: string }): string;
  rateLimit?(context: RequestContext, method: string): void;
  replay?(context: RequestContext, method: string, result: unknown): void;
}
type Invoke = (
  context: RequestContext,
  args: unknown,
  body: Uint8Array,
  signal: CancellationSignal,
) => unknown;
interface StoredOp {
  fingerprint: string;
  result: string;
  body: Uint8Array | null;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) +
            ":" +
            canonical((value as Record<string, unknown>)[key]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
export class LinkHost {
  readonly link: LinkServer;
  private readonly handlers = new Map<
    string,
    { method: Method; invoke: Invoke; binary?: boolean }
  >();
  private readonly pending = new Map<
    string,
    { fingerprint: string; promise: Promise<HandlerResult> }
  >();
  private readonly active = new Set<Promise<HandlerResult>>();
  private readonly userWork = new Map<
    string,
    Set<{ completion: Promise<HandlerResult>; controller: AbortController }>
  >();
  private accepting = true;
  private closed = false;
  private readonly clock: Clock;
  private readonly results: OpResults;
  constructor(private readonly options: LinkHostOptions) {
    this.clock = options.clock ?? systemClock;
    this.results = new OpResults(options.db);
    const id = createUlid({ clock: () => this.clock.now() });
    migrate(
      options.db,
      "ops",
      [
        {
          n: 1,
          up: (db) =>
            db.exec(
              "CREATE TABLE ops(actor TEXT NOT NULL,op TEXT NOT NULL,method TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL CHECK(json_valid(result)),body BLOB,created INTEGER NOT NULL,PRIMARY KEY(actor,op)) STRICT; CREATE INDEX ops_created ON ops(created)",
            ),
        },
      ],
      () => this.clock.now(),
    );
    this.link = new LinkServer({
      acceptHello: (hello) => ({
        v: 1,
        build: options.build,
        now: this.clock.now(),
        device: hello.device ?? id(),
        conn: id(),
      }),
      clock: () => this.clock.now(),
      timers: this.clock,
      reportIncident: (error, context) =>
        options.reportIncident(error, context),
      middleware: (context) => {
        const task = this.dispatch(context);
        this.active.add(task);
        void task.then(
          () => this.active.delete(task),
          () => this.active.delete(task),
        );
        return task;
      },
    });
    this.register(contract.sync.push, (context, args, _body, signal) =>
      this.push(context, args, signal),
    );
  }
  /**
   * Runs batched queued operations one after another, each through the ordinary
   * dispatch (authentication, validation, rate limits, idempotency, its own write
   * transaction). The client batches only mutually independent operations, so one
   * entry's failure never affects the others.
   */
  private async push(
    context: RequestContext,
    args: ArgsOf<typeof contract.sync.push>,
    signal: CancellationSignal,
  ): Promise<ResultOf<typeof contract.sync.push>> {
    const results: ResultOf<typeof contract.sync.push>["results"] = [];
    for (const entry of args.ops) {
      try {
        if (this.handlers.get(entry.method)?.method.offline !== "queue")
          throw new AppError("E_INVALID", "此操作不能批量提交");
        await this.dispatch({
          connection: context.connection,
          method: entry.method,
          args: entry.args,
          body: new Uint8Array(0),
          op: entry.op,
          signal,
        });
        results.push({ op: entry.op });
      } catch (error) {
        if (error instanceof AppError) {
          results.push({ op: entry.op, error: error.toJSON() });
          continue;
        }
        this.options.reportIncident(error, { method: entry.method });
        results.push({
          op: entry.op,
          error: new AppError("E_INTERNAL", "服务器内部错误").toJSON(),
        });
      }
    }
    return { results };
  }
  register<M extends Method>(
    method: M,
    handler: (
      context: RequestContext,
      args: ArgsOf<M>,
      body: Uint8Array,
      signal: CancellationSignal,
    ) => ResultOf<M> | Promise<ResultOf<M>>,
  ): () => void {
    if (this.handlers.has(method.name))
      throw new AppError("E_CONFLICT", "方法已注册");
    this.handlers.set(method.name, { method, invoke: handler as Invoke });
    return () => {
      this.handlers.delete(method.name);
    };
  }
  /** Binary output is validated separately from the typed JSON result. */
  registerBody<M extends Method>(
    method: M,
    handler: (
      context: RequestContext,
      args: ArgsOf<M>,
      body: Uint8Array,
      signal: CancellationSignal,
    ) =>
      | { data: ResultOf<M>; body: Uint8Array }
      | Promise<{ data: ResultOf<M>; body: Uint8Array }>,
  ): () => void {
    if (method.body !== "out")
      throw new AppError("E_INVALID", "方法未声明二进制响应");
    if (this.handlers.has(method.name))
      throw new AppError("E_CONFLICT", "方法已注册");
    this.handlers.set(method.name, {
      method,
      invoke: handler as Invoke,
      binary: true,
    });
    return () => {
      this.handlers.delete(method.name);
    };
  }
  private async dispatch(call: CallContext): Promise<HandlerResult> {
    if (!this.accepting) throw new AppError("E_UNAVAILABLE", "服务器正在关闭");
    const registered = this.handlers.get(call.method);
    if (!registered) throw new AppError("E_NOT_FOUND", "方法不存在");
    const { method, invoke } = registered;
    const identity = this.options.authenticate(call.connection);
    const effects: (() => void)[] = [];
    const context: RequestContext = {
      afterReply: (effect) => {
        effects.push(effect);
      },
      connection: call.connection,
      op: call.op,
      ...identity,
    };
    if (
      (method.auth === "device" && !context.device) ||
      (method.auth === "user" && !context.user)
    ) {
      const admission = call.connection.ctx.get("admission");
      if (admission instanceof AppError) throw admission;
      throw new AppError("E_UNAUTHENTICATED", "请先登录");
    }
    const args = method.args.safeParse(call.args);
    if (!args.success) throw new AppError("E_INVALID", "请求参数无效");
    if (call.body.length && method.body !== "in")
      throw new AppError("E_INVALID", "此方法不接受二进制数据");
    this.options.rateLimit?.(context, method.name);
    const actor =
      method.auth === "user"
        ? `user:${context.user}`
        : `device:${context.device ?? call.connection.id}`;
    const key = JSON.stringify([actor, call.op]);
    const fingerprint = this.results.fingerprint(
      JSON.stringify([method.name, canonical(args.data)]),
      call.body,
    );
    const validate = (value: unknown): HandlerResult => {
      const envelope = registered.binary
        ? (value as { data: unknown; body: unknown })
        : undefined;
      if (
        registered.binary &&
        (!envelope ||
          !(envelope.body instanceof Uint8Array) ||
          envelope.body.length > 512 * 1024)
      )
        throw new AppError("E_INTERNAL", "二进制响应无效或过大");
      const parsed = method.result.safeParse(envelope ? envelope.data : value);
      // Let LinkServer report after the transaction has rolled back, so the
      // incident itself is not lost with the invalid mutation.
      if (!parsed.success) throw parsed.error;
      return {
        data: parsed.data,
        ...(envelope ? { body: envelope.body as Uint8Array } : {}),
      };
    };
    const save = (result: HandlerResult): HandlerResult => {
      if (this.closed) throw new AppError("E_CANCELLED", "服务器已关闭");
      if (call.op)
        this.options.db.run(
          "INSERT INTO ops VALUES(?,?,?,?,?,?,?)",
          actor,
          call.op,
          method.name,
          fingerprint,
          this.results.encode(result.data),
          result.body ?? null,
          this.clock.now(),
        );
      return result;
    };
    if (call.op) {
      this.sweepOps();
      const existing = this.options.db.get<StoredOp>(
        "SELECT fingerprint,result,body FROM ops WHERE actor=? AND op=?",
        actor,
        call.op,
      );
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new AppError("E_CONFLICT", "操作编号已用于其他请求");
        const result = {
          data: this.results.decode(existing.result),
          ...(existing.body ? { body: existing.body } : {}),
        };
        this.options.replay?.(context, method.name, result.data);
        return result;
      }
      const running = this.pending.get(key);
      if (running) {
        if (running.fingerprint !== fingerprint)
          throw new AppError("E_CONFLICT", "操作编号已用于其他请求");
        const result = await running.promise;
        this.options.replay?.(context, method.name, result.data);
        return result;
      }
    }
    const completion = deferred<HandlerResult>();
    // Attach a rejection observer even when there are no replay waiters.
    void completion.promise.catch(() => {});
    if (call.op)
      this.pending.set(key, { fingerprint, promise: completion.promise });
    const controller = new AbortController();
    const abort = () => controller.abort();
    call.signal.addEventListener("abort", abort);
    if (call.signal.aborted) abort();
    const work = { completion: completion.promise, controller };
    if (context.user) {
      const pending = this.userWork.get(context.user) ?? new Set();
      pending.add(work);
      this.userWork.set(context.user, pending);
    }
    try {
      let result: HandlerResult;
      if (method.offline === "queue")
        result = this.options.uow.write(() => {
          const value = invoke(
            context,
            args.data,
            call.body,
            controller.signal,
          );
          if (value && typeof (value as { then?: unknown }).then === "function")
            throw new AppError("E_INTERNAL", "离线方法必须同步提交");
          return save(validate(value));
        });
      else
        result = save(
          validate(
            await invoke(context, args.data, call.body, controller.signal),
          ),
        );
      completion.resolve(result);
      // LinkServer sends the reply in its promise continuation before this turn ends.
      // Gateway shutdown then performs a WebSocket close handshake, flushing queued replies.
      if (effects.length)
        setImmediate(() => {
          for (const effect of effects)
            try {
              effect();
            } catch (error) {
              this.options.reportIncident(error);
            }
        });
      return result;
    } catch (error) {
      completion.reject(error);
      throw error;
    } finally {
      call.signal.removeEventListener("abort", abort);
      if (context.user) {
        const pending = this.userWork.get(context.user)!;
        pending.delete(work);
        if (!pending.size) this.userWork.delete(context.user);
      }
      if (call.op) this.pending.delete(key);
    }
  }
  sweepOps(): number {
    return Number(
      this.options.db.run(
        "DELETE FROM ops WHERE created<?",
        this.clock.now() - OP_RETENTION_MS,
      ).changes,
    );
  }
  /** The caller must persist an admission gate before draining owner work. */
  async drainUser(user: string): Promise<void> {
    const pending = [...(this.userWork.get(user) ?? [])];
    for (const work of pending) work.controller.abort();
    await Promise.allSettled(pending.map((work) => work.completion));
  }
  async drain(timeoutMs = 10000): Promise<void> {
    this.accepting = false;
    if (!this.active.size) return;
    let timer: unknown;
    await Promise.race([
      Promise.allSettled([...this.active]),
      new Promise<void>((resolve) => {
        timer = this.clock.setTimeout(resolve, timeoutMs);
      }),
    ]);
    this.clock.clearTimeout(timer);
  }
  close(): void {
    this.closed = true;
    this.accepting = false;
    this.link.close();
  }
}
