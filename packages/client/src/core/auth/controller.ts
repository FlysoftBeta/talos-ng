import { AppError } from "@talos/base";
import type { ArgsOf, Feature, Method, ResultOf } from "@talos/contract";
import {
  contract,
  hasFeature,
  PIN_FAILURE_LIMIT,
  PIN_THROTTLE_MS,
} from "@talos/contract";
import type { LinkClient, WelcomeHeader } from "@talos/link";
import type { Database } from "@talos/store";
import type { StoredRow } from "../data/db.ts";
import type { BrowserDiagnostics } from "../status/diagnostics.ts";

import type { typedCall } from "../data/link.ts";
import type { Repository } from "../data/repository.ts";
import type { SyncEngine } from "../data/sync-engine.ts";
import type { RuntimeConfiguration as RuntimeOptions } from "../lifecycle/configuration.ts";
import type { Capability, ClientSnapshot } from "../lifecycle/snapshot.ts";
import type { NavGuards } from "../navigation/guards.ts";
import { createNav } from "../navigation/index.ts";
import type { StatusViewModel } from "../status/model.ts";
import type { Admission } from "./admission.ts";
import { admissionFrom } from "./admission.ts";
import type { SessionEnvironment } from "./environment.ts";
import type { PinVerifier } from "./pin.ts";
import { authMessage, createPinVerifier, verifyPin } from "./pin.ts";
import type { SavedSession } from "./session.ts";
import { sessionGate } from "./session.ts";

export interface SessionControllerPorts {
  diagnostics?: Pick<BrowserDiagnostics, "capture">;
  generation: number;
  closed: boolean;
  engine?: SyncEngine;
  status(patch: Partial<StatusViewModel>): void;
  device?: string;
  call: ReturnType<typeof typedCall>;
  publish(patch: Partial<ClientSnapshot>): void;
  db?: Database;
  saved?: SavedSession;
  build: string;
  checkUpdate(): Promise<void>;
  report: (error: unknown) => void;
  revokeOnly?: { token: string; name: string };
  timers: NonNullable<RuntimeOptions["timers"]>;
  idleTimer?: unknown;
  repositories: Map<string, Repository<StoredRow>>;
  link: LinkClient & { interrupt?: () => void };
  snapshot: ClientSnapshot;
  concealment: number;
  now: () => number;
  environment: SessionEnvironment;
  invitationToken?: string;
  options: Pick<RuntimeOptions, "crypto">;
  prepareUser(session: SavedSession, replace?: boolean): Promise<void>;
  navigationGuards: NavGuards;
  applyUpdate(): Promise<void>;
  setting<T>(key: string, fallback: T): T;
  can(method: Method): Capability;
  command<M extends Method>(
    method: M,
    args: ArgsOf<M>,
    options?: { op?: string; body?: Uint8Array; timeoutMs?: number },
  ): Promise<ResultOf<M> | { queued: string }>;
}

export class SessionController {
  constructor(private readonly ports: SessionControllerPorts) {}
  report(error: unknown): void {
    this.ports.diagnostics?.capture(error, "operation");
    const admission = admissionFrom(error);
    if (
      error instanceof AppError &&
      error.code === "E_UNAUTHENTICATED" &&
      this.ports.db &&
      !this.ports.closed
    ) {
      void this.invalidateSession("signedOut", "会话已失效，请重新登录").catch(
        () =>
          this.ports.publish({ error: "无法清除本机登录状态，请重置本机数据" }),
      );
      return;
    }
    if (admission && this.ports.db && !this.ports.closed) {
      if (admission.reason === "throttled")
        this.ports.publish({
          gate: "deviceLocked",
          admission,
          error: authMessage(error),
        });
      else
        void this.invalidateSession(
          "deviceLocked",
          authMessage(error),
          admission,
        ).catch(() =>
          this.ports.publish({ error: "无法清除本机登录状态，请重置本机数据" }),
        );
      return;
    }
    this.ports.publish({
      error: error instanceof AppError ? error.message : "暂时无法保存，请重试",
    });
  }
  revoked(data: unknown): void {
    const reason = (data as { reason?: unknown } | null)?.reason;
    if (reason === "banned")
      void this.invalidateSession("deviceLocked", "设备或账户已被封禁", {
        reason: "banned",
        retryAt: (data as { retryAt?: number }).retryAt,
      });
    else void this.invalidateSession("signedOut", "会话已失效，请重新登录");
  }
  async restore(): Promise<void> {
    this.ports.device = await this.ports
      .db!.table<string, string>("session")
      .get("device");
    this.ports.revokeOnly = await this.ports
      .db!.table<{ token: string; name: string }, string>("session")
      .get("revoke");
    this.ports.publish({
      device: this.ports.device,
      logoutName: this.ports.revokeOnly?.name,
    });
    this.ports.saved = await this.ports
      .db!.table<SavedSession, string>("session")
      .get("active");
    if (this.ports.saved) {
      await this.ports.prepareUser(this.ports.saved);
      this.ports.publish({ gate: sessionGate("boot", "restore") });
    } else this.ports.publish({ gate: sessionGate("boot", "admitted") });
  }
  async connected(welcome: WelcomeHeader): Promise<void> {
    const generation = ++this.ports.generation;
    const current = (): boolean =>
      !this.ports.closed && generation === this.ports.generation;
    this.ports.engine?.phase("authenticating");
    this.ports.status({ connection: "connecting" });
    if (!this.ports.device) {
      const result = await this.ports.call(contract.auth.device.register, {
        label: "Talos II 浏览器",
      });
      if (!current()) return;
      this.ports.device = result.device;
      this.ports.publish({ device: this.ports.device });
      await this.ports
        .db!.table<string, string>("session")
        .put(this.ports.device, "device");
      if (!current()) return;
    }
    if (this.ports.saved) {
      try {
        const saved = this.ports.saved;
        const session = await this.ports.call(contract.auth.resume, {
          token: saved.token,
        });
        if (!current()) return;
        if (session.user.id !== saved.user.id)
          throw new AppError("E_PROTOCOL", "恢复的账户与本机记录不一致");
        const sameCredentials =
          session.credentialVersion !== undefined &&
          saved.credentialVersion === session.credentialVersion;
        this.ports.saved = {
          ...saved,
          ...session,
          ...(sameCredentials
            ? {}
            : { verifier: undefined, verifiers: undefined }),
        };
        await this.saveSession();
        if (!current()) return;
        this.ports.publish({ user: session.user });
        await this.ports.engine?.connect();
      } catch (error) {
        if (!current()) return;
        if (
          error instanceof AppError &&
          ["E_UNAUTHENTICATED", "E_DENIED", "E_LOCKED"].includes(error.code)
        ) {
          await this.invalidateSession(
            error.code === "E_UNAUTHENTICATED" ? "signedOut" : "deviceLocked",
            "会话已失效，请重新登录",
            admissionFrom(error),
          );
        } else throw error;
      }
    } else this.ports.status({ connection: "connected" });
    if (current() && welcome.build !== this.ports.build)
      void this.ports.checkUpdate().catch(this.ports.report);
  }
  async invalidateSession(
    gate: "signedOut" | "deviceLocked",
    error: string,
    admission?: Admission,
  ): Promise<void> {
    ++this.ports.generation;
    if (gate === "deviceLocked" && this.ports.saved)
      this.ports.revokeOnly = {
        token: this.ports.saved.token,
        name: this.ports.saved.user.name,
      };
    if (gate === "signedOut") this.ports.revokeOnly = undefined;
    this.ports.engine?.close();
    this.ports.engine = undefined;
    this.ports.saved = undefined;
    this.ports.timers.clear(this.ports.idleTimer);
    for (const repository of this.ports.repositories.values())
      repository.hydrate([]);
    this.ports.status({
      pending: 0,
      failed: 0,
      operations: [],
      downloads: [],
      lastSync: "尚未同步",
      syncingCount: 0,
      connection: this.ports.link.state === "open" ? "connected" : "offline",
    });
    this.ports.publish({
      gate,
      nav: createNav(),
      user: undefined,
      error,
      admission,
      logoutName: this.ports.revokeOnly?.name,
    });
    const revokeOnly = this.ports.revokeOnly;
    await this.ports.db!.tx(["session"], "readwrite", (tx) => {
      tx.table("session").delete("active");
      if (revokeOnly) tx.table("session").put(revokeOnly, "revoke");
      else tx.table("session").delete("revoke");
    });
  }
  async saveSession(): Promise<void> {
    if (this.ports.saved)
      await this.ports
        .db!.table<SavedSession, string>("session")
        .put(this.ports.saved, "active");
  }
  async login(pin: string): Promise<boolean> {
    if (this.ports.snapshot.busy || this.ports.closed) return false;
    const generation =
      this.ports.saved || this.ports.device
        ? ++this.ports.generation
        : this.ports.generation;
    const concealment = this.ports.concealment;
    const current = (): boolean =>
      !this.ports.closed && generation === this.ports.generation;
    this.ports.publish({ busy: true, error: undefined });
    try {
      if (!/^\d{6}$/.test(pin))
        throw new AppError("E_INVALID", "请输入六位 PIN");
      if (this.ports.saved?.blockedUntil) {
        if (this.ports.saved.blockedUntil > this.ports.now())
          throw new AppError("E_RATE_LIMITED", "尝试次数过多，请稍后再试", {
            reason: "throttled",
            retryAt: this.ports.saved.blockedUntil,
          });
        this.ports.saved = {
          ...this.ports.saved,
          failures: 0,
          blockedUntil: 0,
        };
        await this.saveSession();
        if (!current()) return false;
      }
      if (
        this.ports.link.state === "open" &&
        this.ports.device &&
        this.ports.environment.online()
      ) {
        const session = await this.ports.call(contract.auth.login, { pin });
        if ("onboarding" in session) {
          if (!current()) return false;
          this.ports.invitationToken = session.invitationToken;
          this.ports.publish({ gate: "onboarding", admission: undefined });
          return true;
        }
        if (!current()) return false;
        const verifier = await this.offlineVerifier(pin);
        if (!current()) return false;
        const prior = this.ports.saved;
        const known =
          prior?.user.id === session.user.id &&
          session.credentialVersion !== undefined &&
          prior.credentialVersion === session.credentialVersion
            ? (prior.verifiers ?? (prior.verifier ? [prior.verifier] : []))
            : [];
        const alreadyKnown =
          !(this.ports.options.crypto ?? this.ports.environment.crypto)
            ?.subtle ||
          (
            await Promise.all(
              known.map((item) =>
                verifyPin(
                  pin,
                  item,
                  this.ports.options.crypto ?? this.ports.environment.crypto,
                ),
              ),
            )
          ).some(Boolean);
        if (!current()) return false;
        const verifiers = alreadyKnown
          ? known
          : verifier
            ? [...known, verifier].slice(-2)
            : known;
        this.ports.saved = {
          ...session,
          verifier: verifiers.length === 1 ? verifiers[0] : undefined,
          verifiers,
        };
        this.ports.revokeOnly = undefined;
        await this.ports.db!.table("session").delete("revoke");
        await this.saveSession();
        if (!current()) return false;
        await this.ports.prepareUser(this.ports.saved, true);
        if (!current()) return false;
        await this.ports.engine!.connect();
        if (!current()) return false;
        this.ports.environment.persist();
      } else {
        if (
          !(this.ports.options.crypto ?? this.ports.environment.crypto)?.subtle
        )
          throw new AppError(
            "E_UNAVAILABLE",
            "当前连接不支持离线解锁，请连接服务器登录，或使用 HTTPS / 本机地址",
          );
        if (this.ports.saved && !this.gate("offline").ok)
          throw new AppError(
            "E_DENIED",
            "当前账号未获准离线解锁，请连接服务器",
          );
        if (!this.ports.saved?.verifier && !this.ports.saved?.verifiers?.length)
          throw new AppError(
            "E_OFFLINE",
            "此账户尚未在本机登录，请联网后首次登录",
          );
        const saved = this.ports.saved!;
        const valid = (
          await Promise.all(
            (saved.verifiers ?? [saved.verifier!]).map((verifier) =>
              verifyPin(
                pin,
                verifier,
                this.ports.options.crypto ?? this.ports.environment.crypto,
              ),
            ),
          )
        ).some(Boolean);
        if (!current()) return false;
        if (!valid) {
          const failures = (saved.failures ?? 0) + 1;
          this.ports.saved = {
            ...saved,
            failures,
            blockedUntil:
              failures >= PIN_FAILURE_LIMIT
                ? this.ports.now() + PIN_THROTTLE_MS
                : 0,
          };
          await this.saveSession();
          if (!current()) return false;
          throw new AppError(
            failures >= PIN_FAILURE_LIMIT
              ? "E_RATE_LIMITED"
              : "E_UNAUTHENTICATED",
            "PIN 不正确，请重试",
          );
        }
        this.ports.saved = { ...saved, failures: 0, blockedUntil: 0 };
        await this.saveSession();
        if (!current()) return false;
      }
      // A Back/lock intent during slow hashing must still conceal the completed login.
      if (concealment !== this.ports.concealment) {
        this.ports.publish({ gate: "appLocked", user: this.ports.saved!.user });
        this.ports.engine?.sideState(true);
        return false;
      }
      this.ports.publish({
        gate:
          this.ports.snapshot.gate === "deviceLocked"
            ? "app"
            : sessionGate(this.ports.snapshot.gate, "login"),
        user: this.ports.saved!.user,
        admission: undefined,
        concealed: false,
        logoutName: undefined,
      });
      this.ports.engine?.sideState(false);
      this.resetIdle();
      return true;
    } catch (error) {
      if (current()) {
        const admission = admissionFrom(error, this.ports.saved?.blockedUntil);
        if (admission && admission.reason !== "throttled")
          await this.invalidateSession(
            "deviceLocked",
            authMessage(error),
            admission,
          );
        else
          this.ports.publish({
            error: authMessage(error),
            admission,
            ...(admission ? { gate: "deviceLocked" as const } : {}),
          });
      }
      return false;
    } finally {
      this.ports.publish({ busy: false });
    }
  }
  reveal(): void {
    this.ports.publish({ concealed: false });
  }
  retryAdmission(): void {
    this.ports.publish({
      gate: this.ports.saved ? "appLocked" : "signedOut",
      admission: undefined,
      error: undefined,
    });
  }
  lock(reason: "manual" | "idle" = "manual"): void {
    this.ports.navigationGuards.conceal();
    ++this.ports.concealment;
    this.ports.publish({
      gate: sessionGate(this.ports.snapshot.gate, "lock"),
      concealed: true,
      lockReason: reason,
      error: undefined,
    });
    this.ports.engine?.sideState(true);
    this.ports.timers.clear(this.ports.idleTimer);
    if (this.ports.snapshot.status.update.state === "ready")
      void this.ports.applyUpdate().catch(this.ports.report);
  }
  resetIdle(): void {
    this.ports.timers.clear(this.ports.idleTimer);
    const minutes = this.ports.setting<number>("idleLockMinutes", 5);
    if (
      this.ports.snapshot.gate === "app" &&
      Number.isFinite(minutes) &&
      minutes > 0
    )
      this.ports.idleTimer = this.ports.timers.set(
        () => this.lock("idle"),
        Math.min(minutes * 60_000, 2_147_483_647),
      );
  }
  async offlineVerifier(pin: string): Promise<PinVerifier | undefined> {
    const crypto = this.ports.options.crypto ?? this.ports.environment.crypto;
    return crypto?.subtle ? createPinVerifier(pin, crypto) : undefined;
  }
  async onboard(
    args: Omit<
      ArgsOf<typeof contract.identity.onboarding.complete>,
      "invitationToken"
    >,
  ): Promise<boolean> {
    if (this.ports.snapshot.busy || !this.ports.invitationToken) return false;
    this.ports.publish({ busy: true, error: undefined });
    const generation = ++this.ports.generation;
    const concealment = this.ports.concealment;
    try {
      const session = await this.ports.call(
        contract.identity.onboarding.complete,
        {
          ...args,
          invitationToken: this.ports.invitationToken,
        },
      );
      const verifiers = (
        await Promise.all(args.pins.map((pin) => this.offlineVerifier(pin)))
      ).filter((value): value is NonNullable<typeof value> => !!value);
      if (this.ports.closed || generation !== this.ports.generation)
        return false;
      this.ports.saved = { ...session, verifiers };
      await this.saveSession();
      if (this.ports.closed || generation !== this.ports.generation)
        return false;
      await this.ports.prepareUser(this.ports.saved);
      if (this.ports.closed || generation !== this.ports.generation)
        return false;
      await this.ports.engine!.connect();
      if (this.ports.closed || generation !== this.ports.generation)
        return false;
      this.ports.invitationToken = undefined;
      this.ports.publish({
        gate: concealment === this.ports.concealment ? "app" : "appLocked",
        user: session.user,
        concealed: concealment !== this.ports.concealment,
      });
      this.resetIdle();
      return true;
    } catch (error) {
      this.ports.publish({
        error:
          error instanceof AppError ? error.message : "无法创建账号，请重试",
      });
      return false;
    } finally {
      this.ports.publish({ busy: false });
    }
  }
  async createInvitation(): Promise<
    ResultOf<typeof contract.identity.invitation.create>
  > {
    const capability = this.ports.can(contract.identity.invitation.create);
    if (!capability.ok) throw new AppError("E_DENIED", capability.reason);
    const result = await this.ports.command(
      contract.identity.invitation.create,
      {},
    );
    if ("queued" in result)
      throw new AppError("E_INTERNAL", "邀请不能离线排队");
    return result;
  }
  async updateProfile(
    args: ArgsOf<typeof contract.identity.profile.update>,
  ): Promise<void> {
    const generation = this.ports.generation;
    const result = await this.ports.command(
      contract.identity.profile.update,
      args,
    );
    if (
      "user" in result &&
      this.ports.saved &&
      generation === this.ports.generation &&
      !this.ports.closed
    ) {
      this.ports.saved = { ...this.ports.saved, user: result.user };
      await this.saveSession();
      this.ports.publish({ user: result.user });
    }
  }
  async replacePins(currentPin: string, pins: string[]): Promise<void> {
    const generation = this.ports.generation;
    const result = await this.ports.command(contract.identity.pins.replace, {
      currentPin,
      pins,
    });
    if (
      !this.ports.saved ||
      generation !== this.ports.generation ||
      this.ports.closed
    )
      return;
    // Remove old credentials before deriving replacements, including if crypto fails.
    this.ports.saved = {
      ...this.ports.saved,
      verifier: undefined,
      verifiers: undefined,
      credentialVersion:
        "credentialVersion" in result ? result.credentialVersion : undefined,
      failures: 0,
      blockedUntil: 0,
    };
    await this.saveSession();
    const verifiers = (
      await Promise.all(pins.map((pin) => this.offlineVerifier(pin)))
    ).filter((value): value is NonNullable<typeof value> => !!value);
    if (
      !this.ports.saved ||
      generation !== this.ports.generation ||
      this.ports.closed
    )
      return;
    this.ports.saved = { ...this.ports.saved, verifiers };
    await this.saveSession();
  }
  async logout(): Promise<void> {
    const generation = this.ports.generation;
    await this.ports.command(contract.auth.logout, {
      token: this.ports.saved?.token ?? this.ports.revokeOnly?.token,
    });
    if (this.ports.closed || generation !== this.ports.generation) return;
    await this.invalidateSession("signedOut", "已退出登录");
    this.ports.publish({ concealed: false });
  }
  gate(feature: Feature | "admin" | "invitation" | "ops"): Capability {
    const user = this.ports.snapshot.user;
    if (!user) return { ok: false, reason: "请先登录" };
    const allowed =
      feature === "ops"
        ? user.roles.includes("root")
        : feature === "admin"
          ? user.roles.includes("administrator")
          : feature === "invitation"
            ? user.roles.includes("root") ||
              user.roles.includes("access_manager")
            : hasFeature(user.features, feature);
    return allowed ? { ok: true } : { ok: false, reason: "当前账号未获授权" };
  }
}
