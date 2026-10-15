import type { Installer, InstallerState, ShellManifest } from "@talos/shell";
import type { Database } from "@talos/store";
import type { SessionEnvironment } from "../auth/environment.ts";
import type { FileEnvironment, FileStorage } from "../files/environment.ts";
import type { BrowserDiagnostics } from "../status/diagnostics.ts";
import type { BootHandle } from "./boot.ts";
/** Cross-tab reset capability, owned and closed by the lifecycle controller. */
export interface ResetChannel {
  postMessage(message: string): void;
  close(): void;
}
/** Browser effects only; callbacks keep all session/update decisions in core. */
export interface RuntimeEnvironment
  extends SessionEnvironment, FileEnvironment {
  available(): boolean;
  description(device: string | undefined): string;
  diagnostics(value: BrowserDiagnostics): () => void;
  backTrap(lock: () => void): () => void;
  network(online: () => void, offline: () => void): () => void;
  resetChannel(receive: (message: unknown) => void): ResetChannel | undefined;
  reload(): void;
  boot(build: string, onState: (state: InstallerState) => void): BootHandle;
  exposeInstaller(installer: Installer | undefined): void;
  manifest(): Promise<ShellManifest>;
}
/** IndexedDB lifetime and byte-store creation; schemas live in the adapter. */
export interface StorageEnvironment {
  open(): Promise<Database>;
  files(db: Database, now: () => number): FileStorage;
  reset(device: string | undefined, onBlocked?: () => void): Promise<void>;
}
