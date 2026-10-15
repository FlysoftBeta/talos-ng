import type { ShellError } from "./error.ts";
/** A manifest contains canonical origin-relative paths, including its index.html. */
export interface ShellAsset {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly mime: string;
}
export interface ShellManifest {
  readonly build: string;
  readonly assets: readonly ShellAsset[];
}
export interface StoredAsset {
  readonly bytes: ArrayBuffer;
  readonly mime: string;
  readonly sha256: string;
}
export interface BuildRecord {
  readonly manifest: ShellManifest;
  readonly complete: boolean;
}
export interface ShellStatus {
  readonly active: string | null;
  readonly pending: string | null;
  readonly previous: string | null;
  readonly bootAttempts: number;
  readonly builds: readonly BuildRecord[];
}
export interface InstallProgress {
  readonly completed: number;
  readonly total: number;
  readonly bytes: number;
  readonly totalBytes: number;
}
export type InstallerState =
  | { readonly kind: "none" }
  | { readonly kind: "installing"; readonly progress: InstallProgress }
  | { readonly kind: "ready"; readonly build: string }
  | { readonly kind: "applying" }
  | {
      readonly kind: "failed";
      readonly error: ShellError;
    };
export interface ShellEnvironment {
  readonly indexedDB?: IDBFactory;
  readonly databaseName?: string;
  readonly crypto?: Pick<Crypto, "subtle">;
}
export type ShellFetch = (
  input: string | Request,
  init?: RequestInit,
) => Promise<Response>;
