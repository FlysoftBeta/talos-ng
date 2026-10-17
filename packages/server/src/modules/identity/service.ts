import { AdminDirectory } from "./directory/admin-queries.ts";
import { randomBytes } from "node:crypto";
import { createUlid } from "@talos/base";
import type { User } from "@talos/contract";
import type { Connection } from "@talos/link";
import { migrate } from "../../kernel/persistence/db.ts";
import type { Db } from "../../kernel/persistence/db.ts";
import type { Uow } from "../../kernel/persistence/uow.ts";
import { identityMigrations } from "./schema.ts";
import { PinCredentials } from "./credentials.ts";
import { DirectoryRepo } from "./directory/repo.ts";
import { AdmissionRepo } from "./admission/repo.ts";
import { SessionsRepo } from "./sessions/repo.ts";
import { ProvisioningRepo } from "./provisioning/repo.ts";
import { SessionsService } from "./sessions/service.ts";
import { AdmissionService } from "./admission/service.ts";
import { ProvisioningService } from "./provisioning/service.ts";
export interface IdentityOptions {
  db: Db;
  uow: Uow;
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
  printRootPin?: (pin: string) => void;
  rootPin?: string;
  onBindingChanged?: (connection: Connection) => void;
  onSessionsChanged?: () => void;
  projectAccess?: (user: User) => User;
  accessRevision?: (user: string) => number;
}
export class IdentityService {
  readonly repo: DirectoryRepo;
  readonly directory: AdminDirectory;
  readonly profileCommands: ProvisioningRepo;
  readonly admission: AdmissionService;
  readonly sessions: SessionsService;
  readonly provisioning: ProvisioningService;
  readonly credentials: ProvisioningRepo;
  readonly devices: AdmissionRepo;
  constructor(options: IdentityOptions) {
    const now = options.now ?? Date.now,
      random = options.randomBytes ?? randomBytes;
    const id = createUlid({
      clock: now,
      random: () => (random(4)[0] ?? 0) / 256,
    });
    migrate(options.db, "identity", identityMigrations, now);
    const directory = (this.repo = new DirectoryRepo(
      options.db,
      options.projectAccess,
      options.accessRevision,
      now,
    ));
    const provisioning = (this.credentials = new ProvisioningRepo(options.db));
    this.directory = new AdminDirectory(options.db, directory);
    this.profileCommands = provisioning;
    const admission = (this.devices = new AdmissionRepo(options.db));
    const sessions = new SessionsRepo(options.db);
    provisioning.transaction(() => {
      if (!provisioning.secret())
        provisioning.saveSecret(Buffer.from(random(32)).toString("hex"));
    });
    const credentials = new PinCredentials(provisioning.secret()!, random);
    this.admission = new AdmissionService({ admission, directory, now });
    const dependencies = {
      uow: options.uow,
      onBindingChanged: options.onBindingChanged,
      onSessionsChanged: options.onSessionsChanged,
      printRootPin: options.printRootPin,
      rootPin: options.rootPin,
      now,
      random,
      id,
      credentials,
      directory,
      provisioning,
      admission,
      sessions,
      admissionPolicy: this.admission,
    };
    this.provisioning = new ProvisioningService({
      ...dependencies,
      createSession: (device, user) =>
        this.sessions.createSession(device, user),
    });
    this.sessions = new SessionsService({
      ...dependencies,
      upgradePin: (oldHash, user, pin) =>
        this.provisioning.upgradePin(oldHash, user, pin),
    });
  }
  bootstrap(
    ...args: Parameters<ProvisioningService["bootstrap"]>
  ): ReturnType<ProvisioningService["bootstrap"]> {
    return this.provisioning.bootstrap(...args);
  }
  createUser(
    ...args: Parameters<ProvisioningService["createUser"]>
  ): ReturnType<ProvisioningService["createUser"]> {
    return this.provisioning.createUser(...args);
  }
  registerDevice(
    ...args: Parameters<SessionsService["registerDevice"]>
  ): ReturnType<SessionsService["registerDevice"]> {
    return this.sessions.registerDevice(...args);
  }
  login(
    ...args: Parameters<SessionsService["login"]>
  ): ReturnType<SessionsService["login"]> {
    return this.sessions.login(...args);
  }
  loginAsync(
    ...args: Parameters<SessionsService["loginAsync"]>
  ): ReturnType<SessionsService["loginAsync"]> {
    return this.sessions.loginAsync(...args);
  }
  resume(
    ...args: Parameters<SessionsService["resume"]>
  ): ReturnType<SessionsService["resume"]> {
    return this.sessions.resume(...args);
  }
  authenticate(
    ...args: Parameters<SessionsService["authenticate"]>
  ): ReturnType<SessionsService["authenticate"]> {
    return this.sessions.authenticate(...args);
  }
  bind(
    ...args: Parameters<SessionsService["bind"]>
  ): ReturnType<SessionsService["bind"]> {
    return this.sessions.bind(...args);
  }
  bindDevice(
    ...args: Parameters<SessionsService["bindDevice"]>
  ): ReturnType<SessionsService["bindDevice"]> {
    return this.sessions.bindDevice(...args);
  }
  lock(
    ...args: Parameters<SessionsService["lock"]>
  ): ReturnType<SessionsService["lock"]> {
    return this.sessions.lock(...args);
  }
  logout(
    ...args: Parameters<SessionsService["logout"]>
  ): ReturnType<SessionsService["logout"]> {
    return this.sessions.logout(...args);
  }
  revoke(
    ...args: Parameters<SessionsService["revoke"]>
  ): ReturnType<SessionsService["revoke"]> {
    return this.sessions.revoke(...args);
  }
  issueInvitation(
    ...args: Parameters<ProvisioningService["issueInvitation"]>
  ): ReturnType<ProvisioningService["issueInvitation"]> {
    return this.provisioning.issueInvitation(...args);
  }
  completeOnboarding(
    ...args: Parameters<ProvisioningService["completeOnboarding"]>
  ): ReturnType<ProvisioningService["completeOnboarding"]> {
    return this.provisioning.completeOnboarding(...args);
  }
  updateProfile(
    ...args: Parameters<ProvisioningService["updateProfile"]>
  ): ReturnType<ProvisioningService["updateProfile"]> {
    return this.provisioning.updateProfile(...args);
  }
  replacePins(
    ...args: Parameters<ProvisioningService["replacePins"]>
  ): ReturnType<ProvisioningService["replacePins"]> {
    return this.provisioning.replacePins(...args);
  }
  adminResetPin(
    ...args: Parameters<ProvisioningService["adminResetPin"]>
  ): ReturnType<ProvisioningService["adminResetPin"]> {
    return this.provisioning.adminResetPin(...args);
  }
  adminSetStatus(
    ...args: Parameters<ProvisioningService["adminSetStatus"]>
  ): ReturnType<ProvisioningService["adminSetStatus"]> {
    return this.provisioning.adminSetStatus(...args);
  }
}
