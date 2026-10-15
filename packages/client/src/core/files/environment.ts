import type { FileStore } from "@talos/store";
import type { fetchFileRanges } from "./ranged-download.ts";
/** Byte storage contract; persistent values are ArrayBuffer, never Blob. */
export type FileStorage = Pick<
  FileStore,
  | "has"
  | "owners"
  | "read"
  | "begin"
  | "retain"
  | "releaseOwner"
  | "put"
  | "gc"
  | "listByOwnerPrefix"
>;
/** Browser URL/fetch and storage estimation capabilities, with no session policy. */
export interface FileEnvironment {
  downloadUrl(url: string): string;
  fetch: Parameters<typeof fetchFileRanges>[0]["fetch"];
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}
