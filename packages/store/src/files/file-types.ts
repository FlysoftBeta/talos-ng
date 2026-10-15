import { AppError } from "@talos/base";
export interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}
export interface FileStoreOptions {
  clock?: () => number;
  random?: () => number;
  leaseMs?: number;
  locks?: LockManagerLike | null;
  subtle?: Pick<SubtleCrypto, "digest"> | null;
  estimate?: (() => Promise<{ usage?: number; quota?: number }>) | null;
}
export interface FileWriter {
  readonly written: number;
  append(bytes: ArrayBuffer | Uint8Array): Promise<void>;
  commit(): Promise<void>;
  close(): Promise<void>;
}
export interface FileUsage {
  bytes: number;
  files: number;
  byOwnerPrefix: Record<string, number>;
}
export const chunkRange = (
  rid: string,
): { lower: IDBValidKey; upper: IDBValidKey } => ({
  lower: [rid, 0],
  upper: [rid, Number.MAX_SAFE_INTEGER],
});
export function validRid(rid: string): void {
  if (!/^[0-9a-f]{64}$/.test(rid))
    throw new AppError(
      "E_INVALID",
      "rid must be a lowercase SHA-256 hex digest",
    );
}
export function validSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0)
    throw new AppError("E_INVALID", "Size must be a nonnegative safe integer");
}
