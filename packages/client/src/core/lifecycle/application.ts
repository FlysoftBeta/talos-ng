import type { Stamp } from "@talos/base";
import {
  AppError,
  createUlid,
  Emitter,
  HybridClock,
  Semaphore,
} from "@talos/base";
import type {
  ArgsOf,
  Feature,
  JsonValue,
  Method,
  ResultOf,
} from "@talos/contract";
import { contract } from "@talos/contract";
import type { LinkClient, WelcomeHeader } from "@talos/link";
import type { Database } from "@talos/store";
import type { OutboxItem, Row } from "@talos/sync";
import type { Admission } from "../auth/admission.ts";
import { SessionController } from "../auth/controller.ts";
import type { PinVerifier } from "../auth/pin.ts";
import type { SavedSession } from "../auth/session.ts";
import { CommandController } from "../data/commands.ts";
import type { StoredRow } from "../data/db.ts";
import { subscribeDelta, typedCall } from "../data/link.ts";
import type { ModuleRegistry } from "../data/modules.ts";
import { Repository } from "../data/repository.ts";
import { SessionSyncController } from "../data/session-sync.ts";
import { SettingsController } from "../data/settings.ts";
import type { SyncEngine } from "../data/sync-engine.ts";
import { FilesController } from "../files/controller.ts";
import type { FileStorage } from "../files/environment.ts";
import { EvictionManager } from "../files/eviction.ts";
import { NavigationController } from "../navigation/controller.ts";
import { NavGuards } from "../navigation/guards.ts";
import type { NavIntent } from "../navigation/index.ts";
import { createNav } from "../navigation/index.ts";
import type { ClientIncident } from "../status/diagnostics.ts";
import { BrowserDiagnostics } from "../status/diagnostics.ts";
import { projectDownload } from "../status/downloads.ts";
import type { StatusViewModel } from "../status/model.ts";
import type { BootHandle } from "./boot.ts";
import type { RuntimeConfiguration } from "./configuration.ts";
import type {
  ResetChannel,
  RuntimeEnvironment,
  StorageEnvironment,
} from "./environment.ts";
import type { Capability, ClientSnapshot } from "./snapshot.ts";
import { UpdateController } from "./updates.ts";

/** Owns lifecycle order and the shared session epoch. Controllers receive explicit
 * structural ports into that epoch so a user switch cancels every in-flight lane.
 * Only the app facade exposes the public RuntimePort; these mutable ports stay internal.
 */
export class ApplicationController {
  private readonly updates = new UpdateController(this);
  private readonly navigation = new NavigationController(this);
  private readonly sessionSync = new SessionSyncController(this);
  private readonly settings = new SettingsController(this);
  private readonly commands = new CommandController(this);
  private readonly fileAccess = new FilesController(this);
  private readonly auth = new SessionController(this);
  private readonly events = new Emitter<void>();
  readonly build: string;
  readonly now: () => number;
  readonly clock: HybridClock;
  readonly id: () => string;
  readonly timers: NonNullable<RuntimeConfiguration["timers"]>;
  readonly link: LinkClient & { interrupt?: () => void };
  readonly call: ReturnType<typeof typedCall>;
  diagnostics?: BrowserDiagnostics;
  db?: Database;
  files?: FileStorage;
  eviction?: EvictionManager;
  storageFull = false;
  readonly binaryReads = new Semaphore(4);
  device?: string;
  saved?: SavedSession;
  revokeOnly?: { token: string; name: string };
  invitationToken?: string;
  private resetChannel?: ResetChannel;
  engine?: SyncEngine;
  boot?: BootHandle;
  closed = false;
  generation = 0;
  concealment = 0;
  idleTimer?: unknown;
  updateChecking?: Promise<void>;
  readonly cleanup: (() => void)[] = [];
  readonly navigationGuards = new NavGuards();
  readonly repositories = new Map<string, Repository<StoredRow>>();
  snapshot: ClientSnapshot;
  constructor(
    readonly modules: ModuleRegistry,
    readonly options: RuntimeConfiguration,
    readonly environment: RuntimeEnvironment,
    readonly storage: StorageEnvironment,
  ) {
    this.build = options.build;
    this.now = options.now ?? Date.now;
    this.clock = new HybridClock(this.now);
    this.id = createUlid({ clock: this.now, random: options.random });
    this.timers = options.timers ?? environment.timers;
    this.link = options.link(() => this.device);
    this.call = typedCall(this.link);
    this.snapshot = {
      gate: "boot",
      concealed: true,
      nav: createNav(),
      busy: false,
      status: {
        connection: "offline",
        lastSync: "尚未同步",
        pending: 0,
        failed: 0,
        operations: [],
        downloads: [],
        storage: "尚未估算",
        build: this.build,
        update: { state: "none", message: "尚未检查更新" },
      },
    };
    for (const module of this.modules.modules)
      for (const [name, select] of Object.entries(module.repositories))
        this.repositories.set(`${module.id}.${name}`, new Repository(select));
  }
  getSnapshot = (): ClientSnapshot => this.snapshot;
  private debugOffline = false;
  isDebugOffline(): boolean {
    return this.debugOffline;
  }
  setDebugOffline(value: boolean): void {
    if (!this.snapshot.user?.roles.includes("root"))
      throw new AppError("E_DENIED", "仅根管理员可使用调试控制");
    this.debugOffline = value;
    if (value) {
      ++this.generation;
      this.link.interrupt?.();
      this.engine?.disconnect();
      this.status({ connection: "offline" });
    } else this.link.start();
  }
  subscribe = (fn: () => void): (() => void) => this.events.on(fn);
  publish(patch: Partial<ClientSnapshot>): void {
    if (this.closed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.events.emit();
  }
  status(patch: Partial<StatusViewModel>): void {
    this.publish({ status: { ...this.snapshot.status, ...patch } });
  }
  report = (error: unknown): void => this.auth.report(error);
  async start(): Promise<void> {
    try {
      await this.initialize();
    } catch (error) {
      this.publish({
        gate: "signedOut",
        error:
          error instanceof AppError
            ? error.message
            : "无法读取本机数据，请重试",
      });
    }
  }
  private async initialize(): Promise<void> {
    this.db = await this.storage.open();
    if (this.closed) {
      this.db.close();
      return;
    }
    this.files = this.storage.files(this.db, this.now);
    this.eviction = new EvictionManager(this.db, {
      now: this.now,
      estimate: this.environment.estimate,
      exhausted: () => {
        this.storageFull = true;
        this.status({ storage: "存储空间不足" });
      },
      onEvicted: () => this.engine?.refreshLocal() ?? Promise.resolve(),
    });
    await this.auth.restore();
    if (this.closed) return;
    let wasOpen = this.link.state === "open";
    this.cleanup.push(
      this.link.onState((state) => {
        if (state !== "open") {
          // Retry transitions while already disconnected must not cancel local PIN hashing.
          if (wasOpen) ++this.generation;
          this.engine?.disconnect();
          this.status({
            connection:
              state === "connecting" && this.environment.online()
                ? "connecting"
                : "offline",
          });
        }
        wasOpen = state === "open";
      }),
    );
    this.cleanup.push(
      this.link.onWelcome((welcome) => {
        const pending = this.connected(welcome);
        const generation = this.generation;
        void pending.catch((error: unknown) => {
          if (generation === this.generation) this.report(error);
        });
      }),
    );
    this.cleanup.push(
      subscribeDelta(
        this.link,
        (delta) => {
          const engine = this.engine;
          const generation = this.generation;
          void engine?.delta(delta).catch((error: unknown) => {
            if (this.engine === engine && generation === this.generation)
              this.report(error);
          });
        },
        this.report,
      ),
    );
    this.cleanup.push(
      this.link.on("identity.session.revoked", (event) => {
        this.auth.revoked(event.data);
      }),
    );
    if (this.environment.available()) {
      this.diagnostics = new BrowserDiagnostics(
        {
          user: () => this.saved?.user.id,
          online: () =>
            this.snapshot.status.connection === "connected" &&
            this.snapshot.gate === "app",
          read: async (user) =>
            (await this.db
              ?.table<ClientIncident[], string>("kv")
              .get(`diagnostics:${user}`)) ?? [],
          write: async (user, rows) => {
            await this.db
              ?.table<ClientIncident[], string>("kv")
              .put(rows, `diagnostics:${user}`);
          },
          send: (row) => this.call(contract.admin.incident.report, row),
        },
        this.build,
        () => this.environment.description(this.device),
      );
      this.cleanup.push(this.environment.diagnostics(this.diagnostics));
      this.cleanup.push(this.environment.backTrap(() => this.lock()));
      const online = (): void => {
        if (!this.isDebugOffline()) this.link.start();
      };
      const offline = (): void => {
        ++this.generation;
        this.link.interrupt?.();
        this.engine?.disconnect();
        this.status({ connection: "offline" });
      };
      this.cleanup.push(this.environment.network(online, offline));
    }
    this.cleanup.push(this.environment.activity(() => this.resetIdle()));
    this.resetChannel = this.environment.resetChannel((message) => {
      if (message === "close") {
        this.publish({ gate: "signedOut", concealed: true });
        void this.close();
      }
      if (message === "reload") this.environment.reload();
    });
    this.cleanup.push(() => this.resetChannel?.close());
    if (!this.isDebugOffline()) this.link.start();
    await this.estimateStorage();
  }
  /** Called by React after committing a stable gate. */
  stableGate(): void {
    return this.updates.stableGate();
  }
  async connected(welcome: WelcomeHeader): Promise<void> {
    return this.auth.connected(welcome);
  }
  async invalidateSession(
    gate: "signedOut" | "deviceLocked",
    error: string,
    admission?: Admission,
  ): Promise<void> {
    return this.auth.invalidateSession(gate, error, admission);
  }
  async prepareUser(
    session: SavedSession,
    replace: boolean = false,
  ): Promise<void> {
    return this.sessionSync.prepareUser(session, replace);
  }
  engineChanged(): void {
    return this.sessionSync.engineChanged();
  }
  async saveSession(): Promise<void> {
    return this.auth.saveSession();
  }
  async login(pin: string): Promise<boolean> {
    return this.auth.login(pin);
  }
  reveal(): void {
    return this.auth.reveal();
  }
  retryAdmission(): void {
    return this.auth.retryAdmission();
  }
  lock(reason: "manual" | "idle" = "manual"): void {
    return this.auth.lock(reason);
  }
  resetIdle(): void {
    return this.auth.resetIdle();
  }
  dispatch(intent: NavIntent): void {
    return this.navigation.dispatch(intent);
  }
  commitNavigation(intent: NavIntent): void {
    return this.navigation.commitNavigation(intent);
  }
  gate(feature: Feature | "admin" | "invitation" | "ops"): Capability {
    return this.auth.gate(feature);
  }
  can(method: Method): Capability {
    return this.commands.can(method);
  }
  async command<M extends Method>(
    method: M,
    args: ArgsOf<M>,
    options: { op?: string; body?: Uint8Array; timeoutMs?: number } = {},
  ): Promise<ResultOf<M> | { queued: string }> {
    return this.commands.command(method, args, options);
  }
  delay(callback: () => void, ms: number): unknown {
    return this.timers.set(callback, ms);
  }
  clearDelay(id: unknown): void {
    this.timers.clear(id);
  }
  hasScope(scope: string): boolean {
    return this.sessionSync.hasScope(scope);
  }
  time(): number {
    return this.now();
  }
  async flush(): Promise<void> {
    return this.sessionSync.flush();
  }
  async sync(): Promise<void> {
    return this.sessionSync.sync();
  }
  operation(): { op: string; t: Stamp } {
    return this.commands.operation();
  }
  outbox(): readonly OutboxItem[] {
    return this.sessionSync.outbox();
  }
  async loadRows(scope: string, rows: readonly Row[]): Promise<void> {
    return this.sessionSync.loadRows(scope, rows);
  }
  async fetchBody<M extends Method>(
    method: M,
    args: ArgsOf<M>,
  ): Promise<{ data: ResultOf<M>; body: Uint8Array }> {
    return this.commands.fetchBody(method, args);
  }
  async readFile(rid: string): Promise<Uint8Array | undefined> {
    return this.fileAccess.readFile(rid);
  }
  async hasFile(rid: string): Promise<boolean> {
    return this.fileAccess.hasFile(rid);
  }
  async readFileRange(
    rid: string,
    start: number,
    end: number,
  ): Promise<Uint8Array | undefined> {
    return this.fileAccess.readFileRange(rid, start, end);
  }
  async downloadFile(
    rid: string,
    size: number,
    url: string,
    owner: string,
    onProgress?: (written: number, total: number) => void,
  ): Promise<void> {
    return this.fileAccess.downloadFile(rid, size, url, owner, onProgress);
  }
  async collectFiles(): Promise<void> {
    return this.fileAccess.collectFiles();
  }
  async saveFile(rid: string, bytes: Uint8Array, owner: string): Promise<void> {
    return this.fileAccess.saveFile(rid, bytes, owner);
  }
  async retainFile(rid: string, owner: string): Promise<void> {
    return this.fileAccess.retainFile(rid, owner);
  }
  async releaseFiles(owner: string): Promise<void> {
    return this.fileAccess.releaseFiles(owner);
  }
  async getLocal<T>(key: string): Promise<T | undefined> {
    return this.fileAccess.getLocal(key);
  }
  async setLocal<T>(key: string, value: T): Promise<void> {
    return this.fileAccess.setLocal(key, value);
  }
  assertLocalScope(key: string): void {
    return this.fileAccess.assertLocalScope(key);
  }
  setDownload(
    id: string,
    value:
      | { title: string; progress: number; state?: string; error?: string }
      | undefined,
  ): void {
    const downloads = projectDownload(
      this.snapshot.status.downloads,
      id,
      value,
    );
    this.status({ downloads });
  }
  async setSetting(key: string, value: JsonValue): Promise<void> {
    return this.settings.setSetting(key, value);
  }
  setting<T>(key: string, fallback: T): T {
    return this.settings.setting(key, fallback);
  }
  settingMark(key: string): "pending" | "failed" | undefined {
    return this.settings.settingMark(key);
  }
  async offlineVerifier(pin: string): Promise<PinVerifier | undefined> {
    return this.auth.offlineVerifier(pin);
  }
  async onboard(
    args: Omit<
      ArgsOf<typeof contract.identity.onboarding.complete>,
      "invitationToken"
    >,
  ): Promise<boolean> {
    return this.auth.onboard(args);
  }
  async createInvitation(): Promise<
    ResultOf<typeof contract.identity.invitation.create>
  > {
    return this.auth.createInvitation();
  }
  async updateProfile(
    args: ArgsOf<typeof contract.identity.profile.update>,
  ): Promise<void> {
    return this.auth.updateProfile(args);
  }
  async replacePins(currentPin: string, pins: string[]): Promise<void> {
    return this.auth.replacePins(currentPin, pins);
  }
  async logout(): Promise<void> {
    return this.auth.logout();
  }
  async localOperationCount(): Promise<number> {
    const queues = await this.db!.table<unknown[]>("outbox").range();
    return queues.reduce((count, queue) => count + queue.length, 0);
  }
  async resetLocalData(onBlocked?: () => void): Promise<void> {
    this.resetChannel?.postMessage("close");
    const device = this.device;
    await this.close();
    await this.storage.reset(device, onBlocked);
    this.environment.reload();
  }
  async retry(id: string): Promise<void> {
    return this.commands.retry(id);
  }
  async discard(id: string): Promise<void> {
    return this.commands.discard(id);
  }
  async estimateStorage(): Promise<void> {
    return this.fileAccess.estimateStorage();
  }
  async checkUpdate(): Promise<void> {
    return this.updates.checkUpdate();
  }
  async applyUpdate(): Promise<void> {
    return this.updates.applyUpdate();
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    ++this.generation;
    this.timers.clear(this.idleTimer);
    for (const off of this.cleanup) off();
    this.engine?.close();
    this.link.stop();
    await this.boot?.close();
    this.db?.close();
    this.events.clear();
    this.environment.exposeInstaller(undefined);
  }
}
