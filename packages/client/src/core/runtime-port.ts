import type { Stamp } from "@talos/base";
import type {
  ArgsOf,
  Feature,
  JsonValue,
  Method,
  ResultOf,
  contract,
} from "@talos/contract";
import type { IntervalSetJSON, OutboxItem } from "@talos/sync";
import type { WindowInput } from "./data/sync-engine.ts";
import type { StoredRow } from "./data/db.ts";
import type { Repository } from "./data/repository.ts";
import type { Capability, ClientSnapshot } from "./lifecycle/snapshot.ts";
import type { NavGuards } from "./navigation/guards.ts";
import type { NavIntent } from "./navigation/index.ts";
import type { TransferUpdate } from "./status/model.ts";

/** Validates and dispatches contract commands, including durable queued operations and lost-response retries. */
export interface RuntimeCommandPort {
  can(method: Method): Capability;
  command<M extends Method>(
    method: M,
    args: ArgsOf<M>,
    options?: { op?: string; body?: Uint8Array; timeoutMs?: number },
  ): Promise<ResultOf<M> | { queued: string }>;
  fetchBody<M extends Method>(
    method: M,
    args: ArgsOf<M>,
  ): Promise<{ data: ResultOf<M>; body: Uint8Array }>;
  operation(): { op: string; t: Stamp };
  retry(id: string): Promise<void>;
  discard(id: string): Promise<void>;
  flush(): Promise<void>;
  sync(): Promise<void>;
}

/** Subscribes to immutable runtime snapshots and reads synchronized repositories; queries never open storage. */
export interface RuntimeQueryPort {
  readonly repositories: ReadonlyMap<
    string,
    Pick<Repository<StoredRow>, "getSnapshot" | "subscribe">
  >;
  getSnapshot(): ClientSnapshot;
  subscribe(listener: () => void): () => void;
  hasScope(scope: string): boolean;
  outbox(): readonly OutboxItem[];
  /** Merges a fetched window page or individually read rows into the scope's replica. */
  loadRows(scope: string, input: WindowInput): Promise<void>;
  /** Sequence numbers in lo..hi of a windowed type that are known holes (missing or stale). */
  holes(scope: string, type: string, lo: number, hi: number): IntervalSetJSON;
}

/** Reads and retains session-owned bytes and local values; scope checks and quota recovery remain in core. */
export interface RuntimeFilePort {
  readFile(rid: string): Promise<Uint8Array | undefined>;
  hasFile(rid: string): Promise<boolean>;
  readFileRange(
    rid: string,
    start: number,
    end: number,
  ): Promise<Uint8Array | undefined>;
  downloadFile(
    rid: string,
    size: number,
    url: string,
    owner: string,
    onProgress?: (written: number, total: number) => void,
  ): Promise<void>;
  collectFiles(): Promise<void>;
  saveFile(rid: string, bytes: Uint8Array, owner: string): Promise<void>;
  retainFile(rid: string, owner: string): Promise<void>;
  releaseFiles(owner: string): Promise<void>;
  getLocal<T>(key: string): Promise<T | undefined>;
  setLocal<T>(key: string, value: T): Promise<void>;
}

/** Dispatches navigation intents and registers model guards without browser history or view dependencies. */
export interface RuntimeNavigationPort {
  readonly navigationGuards: Pick<NavGuards, "add">;
  dispatch(intent: NavIntent): void;
}

/** Reports downloads and storage state and exposes the root-only offline diagnostic control. */
export interface RuntimeStatusPort {
  setTransfer(id: string, value: TransferUpdate | undefined): void;
  estimateStorage(): Promise<void>;
  isDebugOffline(): boolean;
  setDebugOffline(value: boolean): void;
}

/** Owns login, offline unlock, concealment, admission, profile and credential transitions. */
export interface RuntimeSessionPort {
  gate(feature: Feature | "admin" | "invitation" | "ops"): Capability;
  login(pin: string): Promise<boolean>;
  reveal(): void;
  retryAdmission(): void;
  lock(reason?: "manual" | "idle"): void;
  onboard(
    args: Omit<
      ArgsOf<typeof contract.identity.onboarding.complete>,
      "invitationToken"
    >,
  ): Promise<boolean>;
  createInvitation(): Promise<
    ResultOf<typeof contract.identity.invitation.create>
  >;
  updateProfile(
    args: ArgsOf<typeof contract.identity.profile.update>,
  ): Promise<void>;
  replacePins(currentPin: string, pins: string[]): Promise<void>;
  logout(): Promise<void>;
}

/** Reads synchronized preferences and sequences timestamped setting commands. */
export interface RuntimeSettingsPort {
  setSetting(key: string, value: JsonValue): Promise<void>;
  setting<T>(key: string, fallback: T): T;
  settingMark(key: string): "pending" | "failed" | undefined;
}

/** Supplies the runtime clock and cancellable delays so models need no browser timers. */
export interface RuntimeClockPort {
  delay(callback: () => void, ms: number): unknown;
  clearDelay(id: unknown): void;
  time(): number;
}

/** Application-host lifecycle and local reset controls; feature models usually need only a smaller capability. */
export interface RuntimeLifecyclePort {
  start(): Promise<void>;
  stableGate(): void;
  localOperationCount(): Promise<number>;
  resetLocalData(onBlocked?: () => void): Promise<void>;
  close(): Promise<void>;
}

/** Complete host surface. Inject Pick<Runtime…Port, …> for the methods a feature actually uses. */
export interface RuntimePort
  extends
    RuntimeCommandPort,
    RuntimeQueryPort,
    RuntimeFilePort,
    RuntimeNavigationPort,
    RuntimeStatusPort,
    RuntimeSessionPort,
    RuntimeSettingsPort,
    RuntimeClockPort,
    RuntimeLifecyclePort {}
