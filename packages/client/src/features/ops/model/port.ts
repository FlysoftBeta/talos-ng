import type { ArgsOf, Method, ResultOf } from "@talos/contract";
import { contract } from "@talos/contract";
import type { Capability } from "../../../core/lifecycle/snapshot.ts";
import type {
  RuntimeCommandPort,
  RuntimeQueryPort,
} from "../../../core/runtime-port.ts";

/** Online-only ops calls, capability checks, and snapshot changes that can flip them. */
export type OpsPort = Pick<RuntimeCommandPort, "can" | "command"> &
  Pick<RuntimeQueryPort, "subscribe">;

/** Every ops control also needs the base ops-settings capability (administrator, online). */
export function opsCapability(port: OpsPort, method: Method): Capability {
  const base = port.can(contract.ops.settings.get);
  return base.ok ? port.can(method) : base;
}

export async function opsCall<M extends Method>(
  port: OpsPort,
  method: M,
  args: ArgsOf<M>,
  options?: { body?: Uint8Array; timeoutMs?: number },
): Promise<ResultOf<M>> {
  const result = await port.command(method, args, options);
  return method.result.parse(result) as ResultOf<M>;
}

export function failureText(failure: unknown, fallback: string): string {
  return failure instanceof Error ? failure.message : fallback;
}

/** Calls that stage or create large artifacts may run for minutes. */
export const LONG_CALL_MS = 300_000;

/** Hands a server-issued ticket URL to the browser's download mechanism. */
export interface DownloadPort {
  download(url: string): void;
}
