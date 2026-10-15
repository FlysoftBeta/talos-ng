import { errorCode } from "../errors.ts";

export function isBusy(error: unknown): boolean {
  return errorCode(error) === "EBUSY" || errorCode(error) === "EPERM";
}
// Three attempts, 30 ms total by default. The caller owns the per-object lock.
export async function retryDelete(
  unlink: () => Promise<void>,
  delay: (ms: number) => Promise<void>,
): Promise<"deleted" | "missing" | "busy"> {
  for (let attempt = 0; ; attempt++) {
    try {
      await unlink();
      return "deleted";
    } catch (error) {
      if (errorCode(error) === "ENOENT") return "missing";
      if (!isBusy(error)) throw error;
      if (attempt === 2) return "busy";
      await delay(10 * (attempt + 1));
    }
  }
}
