import { AppError } from "@talos/base";
import { FEATURES, rolesWithDependencies, contract } from "@talos/contract";
import type { AdminRole, User, ArgsOf } from "@talos/contract";
import type { Uow } from "../../../kernel/persistence/uow.ts";
import type { PinCredentials, PinRecord } from "../credentials.ts";
import type {
  DeviceRecord,
  IdentitySession,
  AdminUserStatus,
} from "../ports.ts";
import { tokenHash } from "../credentials.ts";
import type { AdmissionQueries } from "../admission/ports.ts";
import type { DirectoryQueries } from "../directory/ports.ts";
import type { ProvisioningQueries } from "./ports.ts";
import type { SessionsQueries } from "../sessions/ports.ts";
import type { AdmissionPolicy } from "../admission/ports.ts";
interface ProvisioningOptions {
  admission: Pick<AdmissionQueries, "clearThrottle">;
  createSession: (device: DeviceRecord, user: string) => IdentitySession;
  credentials: PinCredentials;
  directory: Pick<
    DirectoryQueries,
    "boundUserExists" | "countUsers" | "hasHandle" | "publicUser" | "user"
  >;
  id: () => string;
  now: () => number;
  onSessionsChanged?: () => void;
  printRootPin?: (pin: string) => void;
  provisioning: Pick<
    ProvisioningQueries,
    | "claimInvitation"
    | "createUser"
    | "deletePin"
    | "deletePins"
    | "insertInvitation"
    | "invitationPin"
    | "invitationToken"
    | "pin"
    | "pinUser"
    | "savePin"
    | "setCredentialVersion"
    | "setStatus"
    | "transaction"
    | "updateProfile"
  >;
  random: (size: number) => Uint8Array;
  sessions: Pick<SessionsQueries, "revokeOtherSessions" | "session">;
  uow: Uow;
  admissionPolicy: AdmissionPolicy;
}
export class ProvisioningService {
  constructor(private readonly options: ProvisioningOptions) {}
  bootstrap(): void {
    if (this.options.directory.countUsers()) return;
    // Rejection sampling avoids modulo bias over the six-digit credential space.
    let n = 0xffffffff;
    while (n >= 4294000000)
      n = Buffer.from(this.options.random(4)).readUInt32BE();
    const pin = String(n % 1000000).padStart(6, "0");
    this.createUser({ pin, name: "根管理员", handle: "root", roles: ["root"] });
    (
      this.options.printRootPin ??
      ((value) => process.stdout.write(`首次启动 PIN: ${value}\n`))
    )(pin);
  }
  createUser(input: {
    pin: string;
    name: string;
    handle?: string;
    roles?: readonly AdminRole[];
    preparedPins?: readonly PinRecord[];
  }): User {
    if (
      !/^\d{6}$/.test(input.pin) ||
      !input.name.trim() ||
      input.name.length > 30 ||
      (input.handle && !/^[a-zA-Z0-9_]{1,20}$/.test(input.handle))
    )
      throw new AppError("E_INVALID", "用户信息无效");
    const hash =
      input.preparedPins?.[0]?.hash ??
      this.options.credentials.index(input.pin);
    if (
      this.options.provisioning.pinUser(
        this.options.credentials.legacyIndex(input.pin),
      ) ||
      this.options.provisioning.pinUser(
        this.options.credentials.legacyTextIndex(input.pin),
      )
    )
      throw new AppError("E_CONFLICT", "PIN 已被使用");
    if (
      this.options.provisioning.pinUser(hash) ||
      this.options.provisioning.invitationPin(hash, this.options.now())
    )
      throw new AppError("E_CONFLICT", "PIN 已被使用");
    const id = this.options.id();
    const user: User = {
      id,
      name: input.name,
      handle: input.handle ?? id.slice(-20),
      roles: [...rolesWithDependencies(input.roles ?? [])],
      features: [...FEATURES],
    };
    if (this.options.directory.hasHandle(user.handle))
      throw new AppError("E_CONFLICT", "用户名已被使用");
    return this.options.uow.write((ctx) => {
      this.options.provisioning.createUser(
        user,
        hash,
        this.options.now(),
        ctx.rev,
      );
      for (const pin of input.preparedPins ?? [
        this.options.credentials.create(input.pin),
      ])
        this.options.provisioning.savePin(id, pin);
      ctx.changed(`me:${id}`, "profile", id);
      return user;
    });
  }
  async issueInvitation(): Promise<{
    id: string;
    pin: string;
    expires: number;
  }> {
    let pin = "";
    for (let attempts = 0; attempts < 100; attempts++) {
      const value = Buffer.from(this.options.random(4)).readUInt32BE();
      if (value >= 4294000000) continue;
      pin = String(value % 1000000).padStart(6, "0");
      const hash = await this.options.credentials.indexAsync(pin);
      if (
        this.options.provisioning.pinUser(hash) ||
        this.options.provisioning.pinUser(
          this.options.credentials.legacyIndex(pin),
        ) ||
        this.options.provisioning.invitationPin(hash, this.options.now())
      )
        continue;
      const record = await this.options.credentials.createAsync(pin);
      const id = this.options.id(),
        expires = this.options.now() + 7 * 24 * 60 * 60 * 1000;
      const created = this.options.provisioning.transaction(() => {
        if (
          this.options.provisioning.pinUser(hash) ||
          this.options.provisioning.invitationPin(hash, this.options.now())
        )
          return false;
        this.options.provisioning.insertInvitation(
          id,
          this.options.now(),
          expires,
          record,
        );
        return true;
      });
      if (created) return { id, pin, expires };
    }
    throw new AppError("E_BUSY", "暂时无法生成邀请，请重试");
  }
  async completeOnboarding(
    deviceId: string,
    args: ArgsOf<typeof contract.identity.onboarding.complete>,
    ip?: string,
  ): Promise<IdentitySession> {
    const input = contract.identity.onboarding.complete.args.safeParse(args);
    if (!input.success) throw new AppError("E_INVALID", "初始设置无效");
    const records = await Promise.all(
      input.data.pins.map((pin) => this.options.credentials.createAsync(pin)),
    );
    return this.options.uow.write(() => {
      const device = this.options.admissionPolicy.admitDevice(deviceId, ip);
      if (
        device.bound_user &&
        this.options.directory.boundUserExists(device.bound_user)
      )
        this.options.admissionPolicy.denied(
          "bound-to-other-user",
          "此设备已绑定其他用户，不能用于初始设置",
        );
      const invitation = this.options.provisioning.invitationToken(
        tokenHash(input.data.invitationToken),
        deviceId,
        this.options.now(),
      );
      if (!invitation)
        throw new AppError(
          "E_UNAUTHENTICATED",
          "邀请已过期或已使用，请重新输入邀请 PIN",
        );
      this.assertPinsAvailable(records);
      for (const pin of input.data.pins)
        if (
          this.options.provisioning.pinUser(
            this.options.credentials.legacyIndex(pin),
          )
        )
          throw new AppError("E_CONFLICT", "PIN 已被使用");
      const user = this.createUser({
        pin: input.data.pins[0]!,
        name: input.data.name,
        handle: input.data.handle,
        preparedPins: records,
      });
      this.options.provisioning.claimInvitation(invitation.id, user.id);
      return this.options.createSession(device, user.id);
    });
  }
  updateProfile(
    userId: string,
    args: ArgsOf<typeof contract.identity.profile.update>,
  ): { user: User } {
    const input = contract.identity.profile.update.args.safeParse(args);
    if (!input.success) throw new AppError("E_INVALID", "个人资料无效");
    const previous = this.options.directory.user(userId);
    if (!previous) throw new AppError("E_NOT_FOUND", "用户不存在");
    const handle = input.data.handle ?? previous.handle;
    if (
      handle.toLowerCase() !== previous.handle.toLowerCase() &&
      this.options.directory.hasHandle(handle)
    )
      throw new AppError("E_CONFLICT", "用户名已被使用");
    return this.options.uow.write((ctx) => {
      this.options.provisioning.updateProfile(
        userId,
        handle,
        input.data.name ?? previous.name,
        ctx.rev,
      );
      ctx.changed(`me:${userId}`, "profile", userId);
      return {
        user: this.options.directory.publicUser(
          this.options.directory.user(userId)!,
        ),
      };
    });
  }
  async replacePins(
    user: string,
    deviceId: string,
    keepHash: string | undefined,
    args: ArgsOf<typeof contract.identity.pins.replace>,
    ip?: string,
  ): Promise<{ ok: true; credentialVersion: number }> {
    const parsed = contract.identity.pins.replace.args.safeParse(args);
    if (!parsed.success) throw new AppError("E_INVALID", "PIN 设置无效");
    this.options.admissionPolicy.admitDevice(deviceId, ip);
    const currentHash = await this.options.credentials.indexAsync(
      args.currentPin,
    );
    const current =
      this.options.provisioning.pin(currentHash) ??
      this.options.provisioning.pin(
        this.options.credentials.legacyIndex(args.currentPin),
      );
    const valid = await this.options.credentials.verifyAsync(
      args.currentPin,
      current,
    );
    const device = this.options.admissionPolicy.admitDevice(deviceId, ip);
    if (!valid || current?.user_id !== user)
      this.options.admissionPolicy.failedPin(device, ip);
    const pins = await Promise.all(
      args.pins.map((pin) => this.options.credentials.createAsync(pin)),
    );
    const credentialVersion = this.options.uow.write((ctx) => {
      this.options.admissionPolicy.admitDevice(deviceId, ip);
      this.options.admissionPolicy.admitUser(user, device);
      const session = keepHash
        ? this.options.sessions.session(keepHash)
        : undefined;
      if (
        !session ||
        session.user_id !== user ||
        session.device_id !== deviceId ||
        session.expires <= this.options.now()
      )
        throw new AppError("E_UNAUTHENTICATED", "会话已失效，请重新登录");
      if (
        !current ||
        this.options.provisioning.pin(current.hash)?.user_id !== user
      )
        throw new AppError("E_UNAUTHENTICATED", "当前 PIN 已失效", {
          reason: "invalid-pin",
        });
      this.assertPinsAvailable(pins, user);
      for (const pin of args.pins) {
        const owner = this.options.provisioning.pinUser(
          this.options.credentials.legacyIndex(pin),
        );
        if (owner && owner !== user)
          throw new AppError("E_CONFLICT", "PIN 已被使用");
      }
      this.options.provisioning.deletePins(user);
      this.options.provisioning.setCredentialVersion(user, ctx.rev);
      ctx.changed(`me:${user}`, "profile", user);
      pins.forEach((pin) => this.options.provisioning.savePin(user, pin));
      this.options.sessions.revokeOtherSessions(user, keepHash);
      this.options.admission.clearThrottle(deviceId);
      ctx.afterCommit(() => this.options.onSessionsChanged?.());
      return ctx.rev;
    });
    return { ok: true, credentialVersion };
  }
  async adminResetPin(user: string, pin: string): Promise<void> {
    if (!/^\d{6}$/.test(pin)) throw new AppError("E_INVALID", "PIN 格式无效");
    const record = await this.options.credentials.createAsync(pin);
    this.options.uow.write((ctx) => {
      const current = this.options.directory.user(user);
      if (!current || current.deleted || current.purging)
        throw new AppError("E_NOT_FOUND", "用户不存在");
      this.assertPinsAvailable([record], user);
      const owner = this.options.provisioning.pinUser(
        this.options.credentials.legacyIndex(pin),
      );
      if (owner && owner !== user)
        throw new AppError("E_CONFLICT", "PIN 已被使用");
      this.options.provisioning.deletePins(user);
      this.options.provisioning.savePin(user, record);
      this.options.provisioning.setCredentialVersion(user, ctx.rev);
      this.options.sessions.revokeOtherSessions(user);
      ctx.changed(`me:${user}`, "profile", user);
      ctx.afterCommit(() => this.options.onSessionsChanged?.());
    });
  }
  adminSetStatus(user: string, input: AdminUserStatus): void {
    this.options.uow.write((ctx) => {
      const current = this.options.directory.user(user);
      if (!current) throw new AppError("E_NOT_FOUND", "用户不存在");
      const banned =
        input.banned === undefined ? current.banned : Number(input.banned);
      const bannedUntil = !banned
        ? null
        : input.banned === true
          ? (input.bannedUntil ?? null)
          : current.banned_until;
      if (bannedUntil !== null && bannedUntil <= this.options.now())
        throw new AppError("E_INVALID", "封禁截止时间必须在未来");
      const deleted =
        input.deactivated === undefined
          ? current.deleted
          : Number(input.deactivated);
      this.options.provisioning.setStatus(
        user,
        banned,
        bannedUntil,
        deleted,
        ctx.rev,
      );
      if (banned || deleted) this.options.sessions.revokeOtherSessions(user);
      ctx.changed(`me:${user}`, "profile", user);
      ctx.afterCommit(() => this.options.onSessionsChanged?.());
    });
  }
  upgradePin(oldHash: string, user: string, pin: PinRecord): void {
    this.options.provisioning.transaction(() => {
      if (this.options.provisioning.pin(oldHash)?.user_id !== user)
        throw new AppError("E_UNAUTHENTICATED", "当前 PIN 已失效", {
          reason: "invalid-pin",
        });
      this.options.provisioning.deletePin(oldHash);
      this.options.provisioning.savePin(user, pin);
    });
  }
  private assertPinsAvailable(pins: readonly PinRecord[], user?: string): void {
    for (const pin of pins) {
      const owner = this.options.provisioning.pinUser(pin.hash);
      if (
        (owner && owner !== user) ||
        this.options.provisioning.invitationPin(pin.hash, this.options.now())
      )
        throw new AppError("E_CONFLICT", "PIN 已被使用");
    }
  }
}
