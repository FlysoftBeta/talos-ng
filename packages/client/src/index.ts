export type { BootEnvironment, BootHandle } from "./core/lifecycle/boot.ts";
export * from "./core/navigation/index.ts";
export { createBoot } from "./platform/transport/boot.ts";

export {
  LinkConnectionStore,
  toStatusConnection,
} from "./core/status/link-status.ts";
export type { LinkConnection } from "./core/status/link-status.ts";

export { toUpdateStatus } from "./core/status/update-status.ts";

export type { RuntimeOptions } from "./app/runtime-options.ts";
export { ClientRuntime, createClientRuntime } from "./app/runtime.ts";
export type { StoredRow, StoredScope } from "./core/data/db.ts";
export { subscribeDelta, typedCall } from "./core/data/link.ts";
export { ModuleRegistry, defineClientModule } from "./core/data/modules.ts";
export type { ClientModule, ProjectionContext } from "./core/data/modules.ts";
export { Repository } from "./core/data/repository.ts";
export { SyncEngine } from "./core/data/sync-engine.ts";
export type {
  EngineOptions,
  SyncPhase,
  SyncSnapshot,
} from "./core/data/sync-engine.ts";
export type { Capability, ClientSnapshot } from "./core/lifecycle/snapshot.ts";
export {
  RuntimeProvider,
  useCan,
  useClientSnapshot,
  useRepository,
  useRuntime,
} from "./platform/react/context.tsx";
export { appMigrations, openAppDb } from "./platform/storage/database.ts";
export { createAppLink } from "./platform/transport/link.ts";

export { sessionGate } from "./core/auth/session.ts";
export type { Gate, GateEvent, SavedSession } from "./core/auth/session.ts";
export type { TypedCall } from "./core/data/link.ts";
export type { StatusViewModel } from "./core/status/model.ts";

export { installBackTrap } from "./platform/browser/back-trap.ts";
export type { BackTrapHost } from "./platform/browser/back-trap.ts";
export type { BrowserBootOptions as BootOptions } from "./platform/transport/boot.ts";

export type {
  RuntimeClockPort,
  RuntimeCommandPort,
  RuntimeFilePort,
  RuntimeLifecyclePort,
  RuntimeNavigationPort,
  RuntimePort,
  RuntimeQueryPort,
  RuntimeSessionPort,
  RuntimeSettingsPort,
  RuntimeStatusPort,
} from "./core/runtime-port.ts";
