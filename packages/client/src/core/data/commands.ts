import type { Stamp, HybridClock, Semaphore } from "@talos/base";
import { AppError } from "@talos/base";
import type { ArgsOf, Feature, Method, ResultOf } from "@talos/contract";
import { opsActionRole } from "@talos/contract";
import type { LinkClient } from "@talos/link";
import type { Admission } from "../auth/admission.ts";
import { admissionFrom } from "../auth/admission.ts";
import { authMessage } from "../auth/pin.ts";
import type { SavedSession } from "../auth/session.ts";
import type { Capability } from "../lifecycle/snapshot.ts";
import type { ClientSnapshot } from "../lifecycle/snapshot.ts";
import type { BrowserDiagnostics } from "../status/diagnostics.ts";
import type { typedCall } from "./link.ts";
import type { ModuleRegistry } from "./modules.ts";
import type { SyncEngine } from "./sync-engine.ts";

export interface CommandControllerPorts {
  snapshot: ClientSnapshot;
  gate(feature: Feature | "admin" | "invitation" | "ops"): Capability;
  saved?: SavedSession;
  isDebugOffline(): boolean;
  link: LinkClient & { interrupt?: () => void };
  engine?: SyncEngine;
  modules: ModuleRegistry;
  generation: number;
  call: ReturnType<typeof typedCall>;
  diagnostics?: BrowserDiagnostics;
  closed: boolean;
  invalidateSession(
    gate: "signedOut" | "deviceLocked",
    error: string,
    admission?: Admission,
  ): Promise<void>;
  id: () => string;
  now: () => number;
  binaryReads: Semaphore;
  report: (error: unknown) => void;
  clock: HybridClock;
}

export class CommandController {
  constructor(private readonly ports: CommandControllerPorts) {}
  can(method: Method): Capability {
    if (
      method.name.startsWith("ai.admin.") &&
      !this.ports.snapshot.user?.roles.some(
        (role) => role === "root" || role === "feature_manager",
      )
    )
      return { ok: false, reason: "只有功能管理员可以管理 AI 额度" };
    if (
      method.name.startsWith("ai.") &&
      !method.name.startsWith("ai.admin.") &&
      !this.ports.gate("ai").ok
    )
      return this.ports.gate("ai");
    if (method.name.startsWith("library.") && !this.ports.gate("articles").ok)
      return this.ports.gate("articles");
    if (
      method.name === "library.retention.set" &&
      !this.ports.gate("offline").ok
    )
      return this.ports.gate("offline");
    if (method.name.startsWith("ops.")) {
      const role = opsActionRole(method.name);
      const permission = role
        ? this.ports.gate(role === "root" ? "ops" : "admin")
        : { ok: false as const, reason: "当前账号未获授权" };
      if (!permission.ok) return permission;
    }
    if (
      method.name === "identity.invitation.create" &&
      !this.ports.gate("invitation").ok
    )
      return this.ports.gate("invitation");
    if (method.auth === "user" && !this.ports.saved)
      return { ok: false, reason: "请先登录" };
    if (method.auth === "user" && this.ports.snapshot.gate !== "app")
      return { ok: false, reason: "请先解锁" };
    if (
      method.offline === "online" &&
      (this.ports.isDebugOffline() || this.ports.link.state !== "open")
    )
      return { ok: false, reason: "此操作需要连接服务器" };
    if (
      method.auth === "user" &&
      method.offline === "online" &&
      !(["live", "syncing"] as const).some(
        (phase) => phase === this.ports.engine?.getSnapshot().phase,
      )
    )
      return { ok: false, reason: "正在恢复会话，请稍后重试" };
    if (method.offline === "queue" && !this.ports.modules.supports(method.name))
      return { ok: false, reason: "此操作暂不支持离线保存" };
    return { ok: true };
  }
  async command<M extends Method>(
    method: M,
    args: ArgsOf<M>,
    options: { op?: string; body?: Uint8Array; timeoutMs?: number } = {},
  ): Promise<ResultOf<M> | { queued: string }> {
    const capability = this.can(method);
    if (!capability.ok) throw new AppError("E_UNAVAILABLE", capability.reason);
    const parsed = method.args.safeParse(args);
    if (!parsed.success) throw new AppError("E_INVALID", "操作参数无效");
    if (method.offline === "online") {
      const generation = this.ports.generation;
      try {
        return await this.ports.call(method, args, options);
      } catch (error) {
        this.ports.diagnostics?.capture(error, "operation");
        const admission = admissionFrom(error);
        const invalidSession =
          error instanceof AppError &&
          error.code === "E_UNAUTHENTICATED" &&
          (error.data as { reason?: string } | undefined)?.reason !==
            "invalid-pin";
        if (
          invalidSession &&
          generation === this.ports.generation &&
          !this.ports.closed
        )
          await this.ports.invalidateSession(
            "signedOut",
            "会话已失效，请重新登录",
          );
        else if (
          admission &&
          generation === this.ports.generation &&
          !this.ports.closed
        )
          await this.ports.invalidateSession(
            "deviceLocked",
            authMessage(error),
            admission,
          );
        throw error;
      }
    }
    const op = options.op ?? this.ports.id();
    await this.ports.engine!.enqueue({
      op,
      method: method.name,
      args: parsed.data,
      createdAt: this.ports.now(),
    });
    return { queued: op };
  }
  async fetchBody<M extends Method>(
    method: M,
    args: ArgsOf<M>,
  ): Promise<{ data: ResultOf<M>; body: Uint8Array }> {
    const capability = this.can(method);
    if (!capability.ok) throw new AppError("E_UNAVAILABLE", capability.reason);
    if (method.body !== "out")
      throw new AppError("E_INVALID", "方法未声明二进制响应");
    const parsed = method.args.safeParse(args);
    if (!parsed.success) throw new AppError("E_INVALID", "调用参数无效");
    const generation = this.ports.generation;
    await this.ports.binaryReads.acquire();
    try {
      if (generation !== this.ports.generation || this.ports.closed)
        throw new AppError("E_CANCELLED", "旧会话请求已取消");
      const reply = await this.ports.link.call(method.name, parsed.data);
      if (generation !== this.ports.generation || this.ports.closed)
        throw new AppError("E_CANCELLED", "旧会话请求已取消");
      const result = method.result.safeParse(reply.data);
      if (!result.success) throw new AppError("E_PROTOCOL", "服务器响应无效");
      return { data: result.data as ResultOf<M>, body: reply.body };
    } catch (error) {
      if (
        generation === this.ports.generation &&
        !this.ports.closed &&
        (admissionFrom(error) ||
          (error instanceof AppError && error.code === "E_UNAUTHENTICATED"))
      )
        this.ports.report(error);
      throw error;
    } finally {
      this.ports.binaryReads.release();
    }
  }
  operation(): { op: string; t: Stamp } {
    return { op: this.ports.id(), t: this.ports.clock.now() };
  }
  async retry(id: string): Promise<void> {
    await this.ports.engine?.retry(id);
  }
  async discard(id: string): Promise<void> {
    await this.ports.engine?.discard(id);
  }
}
