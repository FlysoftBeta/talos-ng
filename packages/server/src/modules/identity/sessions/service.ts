import { AppError } from "@talos/base";
import { SESSION_TTL_MS } from "@talos/contract";
import type { Connection } from "@talos/link";
import type { Uow } from "../../../kernel/persistence/uow.ts";
import type { PinCredentials, PinRecord } from "../credentials.ts";
import type { DeviceRecord, IdentitySession } from "../ports.ts";
import { tokenHash } from "../credentials.ts";
import { sessionState } from "./binding.ts";
import type { AdmissionQueries } from "../admission/ports.ts";
import type { DirectoryQueries } from "../directory/ports.ts";
import type { ProvisioningQueries } from "../provisioning/ports.ts";
import type { SessionsQueries } from "./ports.ts";
import type { AdmissionPolicy } from "../admission/ports.ts";
interface SessionsOptions {
  admission: Pick<
    AdmissionQueries,
    | "bindDeviceSignals"
    | "checkDeviceSignals"
    | "clearThrottle"
    | "createDevice"
    | "device"
  >;
  credentials: PinCredentials;
  directory: Pick<
    DirectoryQueries,
    "active" | "boundUserExists" | "publicUser"
  >;
  id: () => string;
  now: () => number;
  onBindingChanged?: (connection: Connection) => void;
  onSessionsChanged?: () => void;
  provisioning: Pick<
    ProvisioningQueries,
    "invitationPin" | "issueInvitationToken" | "pin"
  >;
  random: (size: number) => Uint8Array;
  sessions: Pick<
    SessionsQueries,
    | "extendSession"
    | "otherSessionCount"
    | "revoke"
    | "saveSession"
    | "seenDevice"
    | "session"
    | "touchDevice"
    | "transaction"
  >;
  uow: Uow;
  upgradePin: (oldHash: string, user: string, pin: PinRecord) => void;
  admissionPolicy: AdmissionPolicy;
}
const ACTIVITY_REFRESH_MS = 60_000;
const DEVICE_TOUCH_MS = 5_000;
export class SessionsService {
  constructor(private readonly options: SessionsOptions) {}
  registerDevice(label = "", ip?: string, userAgent?: string): string {
    if (label.length > 1000) throw new AppError("E_INVALID", "设备名称过长");
    const id = this.options.id();
    this.options.admission.createDevice(id, label, this.options.now());
    this.options.admission.bindDeviceSignals(id, ip, userAgent);
    return id;
  }
  login(deviceId: string, pin: string, ip?: string): IdentitySession {
    const device = this.options.admissionPolicy.admitDevice(deviceId, ip);
    const record =
      this.options.provisioning.pin(this.options.credentials.index(pin)) ??
      this.options.provisioning.pin(this.options.credentials.legacyIndex(pin));
    if (!this.options.credentials.verify(pin, record))
      this.options.admissionPolicy.failedPin(device, ip);
    if (record!.verifier === null)
      this.options.upgradePin(
        record!.hash,
        record!.user_id,
        this.options.credentials.create(pin),
      );
    return this.createSession(device, record!.user_id);
  }
  async loginAsync(
    deviceId: string,
    pin: string,
    ip?: string,
    userAgent?: string,
  ): Promise<IdentitySession | { onboarding: true; invitationToken: string }> {
    this.options.admission.checkDeviceSignals(deviceId, ip, userAgent);
    this.options.admissionPolicy.admitDevice(deviceId, ip);
    const hash = await this.options.credentials.indexAsync(pin);
    const record =
      this.options.provisioning.pin(hash) ??
      this.options.provisioning.pin(this.options.credentials.legacyIndex(pin));
    const invitation = this.options.provisioning.invitationPin(
      hash,
      this.options.now(),
    );
    const valid = await this.options.credentials.verifyAsync(
      pin,
      record ?? invitation,
    );
    const device = this.options.admissionPolicy.admitDevice(deviceId, ip);
    if (!valid) this.options.admissionPolicy.failedPin(device, ip);
    if (invitation && !record) {
      if (
        device.bound_user &&
        this.options.directory.boundUserExists(device.bound_user)
      )
        this.options.admissionPolicy.denied(
          "bound-to-other-user",
          "此设备已绑定其他用户，不能用于初始设置",
        );
      const token = Buffer.from(this.options.random(32)).toString("hex");
      this.options.provisioning.issueInvitationToken(
        invitation.id,
        tokenHash(token),
        deviceId,
        this.options.now() + 15 * 60 * 1000,
      );
      this.options.admission.clearThrottle(deviceId);
      return { onboarding: true, invitationToken: token };
    }
    // A replacement while the KDF was running must not resurrect a deleted PIN.
    if (
      !record ||
      this.options.provisioning.pin(record.hash)?.user_id !== record.user_id
    )
      this.options.admissionPolicy.failedPin(device, ip);
    if (record!.verifier === null)
      this.options.upgradePin(
        record!.hash,
        record!.user_id,
        await this.options.credentials.createAsync(pin),
      );
    return this.createSession(
      this.options.admissionPolicy.admitDevice(deviceId, ip),
      record!.user_id,
    );
  }
  createSession(device: DeviceRecord, userId: string): IdentitySession {
    const deviceId = device.id;
    // A fresh correct credential recovers idle admission; token restore does not.
    const user = this.options.admissionPolicy.admitUser(userId, {
      ...device,
      last_seen: this.options.now(),
    });
    const activeUsers = this.options.sessions.otherSessionCount(
      deviceId,
      user.id,
      this.options.now(),
    );
    if (activeUsers >= 2)
      throw new AppError(
        "E_CONFLICT",
        "设备最多保存两个账户，请先退出一个账户",
      );
    const token = Buffer.from(this.options.random(32)).toString("hex");
    const expires = this.options.now() + SESSION_TTL_MS;
    this.options.sessions.transaction(() => {
      this.options.sessions.saveSession(
        tokenHash(token),
        user.id,
        deviceId,
        this.options.now(),
        expires,
      );
    });
    if (this.options.uow.current)
      this.options.uow.current.afterCommit(() =>
        this.options.onSessionsChanged?.(),
      );
    else this.options.onSessionsChanged?.();
    return {
      user: this.options.directory.publicUser(user),
      token,
      expires,
      credentialVersion: user.credential_version,
    };
  }
  resume(
    deviceId: string,
    token: string,
    ip?: string,
    userAgent?: string,
  ): IdentitySession {
    this.options.admission.checkDeviceSignals(deviceId, ip, userAgent);
    const device = this.options.admissionPolicy.admitDevice(deviceId);
    const session = this.options.sessions.session(tokenHash(token));
    if (
      !session ||
      session.device_id !== deviceId ||
      session.expires <= this.options.now()
    )
      throw new AppError("E_UNAUTHENTICATED", "会话已失效");
    const user = this.options.admissionPolicy.admitUser(
      session.user_id,
      device,
    );
    const expires = this.options.now() + SESSION_TTL_MS;
    this.options.sessions.extendSession(session.hash, expires);
    this.options.sessions.seenDevice(deviceId, this.options.now());
    return {
      user: this.options.directory.publicUser(user),
      token,
      expires,
      credentialVersion: user.credential_version,
    };
  }
  authenticate(connection: Connection): { user?: string; device?: string } {
    let state = sessionState(connection);
    if (
      !state &&
      connection.device &&
      this.options.admission.device(connection.device)
    ) {
      state = { device: connection.device };
      connection.ctx.set("session", state);
    }
    if (!state || !this.options.admission.device(state.device)) {
      if (state?.device || connection.device)
        connection.ctx.set(
          "admission",
          new AppError("E_UNAUTHENTICATED", "此设备编号无效，请联系管理员", {
            reason: "invalid-client",
          }),
        );
      return {};
    }
    if (state.user) {
      const session = state.tokenHash
        ? this.options.sessions.session(state.tokenHash)
        : undefined;
      const device = this.options.admission.device(state.device)!;
      let admitted = true;
      try {
        this.options.admissionPolicy.admitDevice(device.id);
        this.options.admissionPolicy.admitUser(state.user, device);
        connection.ctx.delete("admission");
      } catch (error) {
        admitted = false;
        if (error instanceof AppError) connection.ctx.set("admission", error);
      }
      if (
        !session ||
        session.user_id !== state.user ||
        session.device_id !== state.device ||
        session.expires <= this.options.now() ||
        !this.options.directory.active(state.user) ||
        device.locked ||
        !admitted ||
        (device.bound_user &&
          this.options.directory.boundUserExists(device.bound_user) &&
          device.bound_user !== state.user)
      ) {
        state = { device: state.device };
        connection.ctx.set("session", state);
        this.options.onBindingChanged?.(connection);
      } else if (
        // Authentication runs for every connection on every commit; refresh
        // the sliding expiry at most once a minute instead of writing each time.
        session.expires <
        this.options.now() + SESSION_TTL_MS - ACTIVITY_REFRESH_MS
      )
        this.options.sessions.extendSession(
          session.hash,
          this.options.now() + SESSION_TTL_MS,
        );
    }
    // Only authenticated activity keeps idle admission alive (minutes-scale,
    // so a few seconds of write coalescing cannot lock an active device).
    if (state.user) {
      const device = this.options.admission.device(state.device);
      if (
        !device ||
        this.options.now() - device.last_seen >= DEVICE_TOUCH_MS ||
        device.last_seen > this.options.now()
      )
        this.options.sessions.touchDevice(state.device, this.options.now());
    }
    return {
      device: state.device,
      ...(state.user ? { user: state.user } : {}),
    };
  }
  bind(connection: Connection, session: IdentitySession, device: string): void {
    connection.ctx.delete("admission");
    connection.ctx.set("session", {
      device,
      user: session.user.id,
      tokenHash: tokenHash(session.token),
    });
    this.options.onBindingChanged?.(connection);
  }
  bindDevice(connection: Connection, device: string): void {
    connection.ctx.delete("admission");
    connection.ctx.set("session", { device });
    this.options.onBindingChanged?.(connection);
  }
  lock(connection: Connection): void {
    const state = sessionState(connection);
    if (state) this.bindDevice(connection, state.device);
  }
  logout(connection: Connection, token?: string): void {
    const state = sessionState(connection);
    const hash = token ? tokenHash(token) : state?.tokenHash;
    if (
      hash &&
      this.options.sessions.session(hash)?.device_id === state?.device
    )
      this.revoke(hash);
    this.lock(connection);
  }
  revoke(tokenHash: string): void {
    this.options.sessions.revoke(tokenHash);
    this.options.onSessionsChanged?.();
  }
}
