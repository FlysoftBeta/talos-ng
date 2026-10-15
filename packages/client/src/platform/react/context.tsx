import { AppError } from "@talos/base";
import type { Feature, Method } from "@talos/contract";
import type { ReactElement, ReactNode } from "react";
import { createContext, useContext, useSyncExternalStore } from "react";
import type { Repository } from "../../core/data/repository.ts";
import type {
  Capability,
  ClientSnapshot,
} from "../../core/lifecycle/snapshot.ts";
import type { RuntimePort } from "../../core/runtime-port.ts";
const RuntimeContext = createContext<RuntimePort | null>(null);
export function RuntimeProvider({
  runtime,
  children,
}: {
  runtime: RuntimePort;
  children: ReactNode;
}): ReactElement {
  return (
    <RuntimeContext.Provider value={runtime}>
      {children}
    </RuntimeContext.Provider>
  );
}
export function useRuntime(): RuntimePort {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new AppError("E_INTERNAL", "缺少客户端运行环境");
  return runtime;
}
export function useClientSnapshot(): ClientSnapshot {
  const runtime = useRuntime();
  return useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
}
export function useCan(method: Method): Capability {
  const runtime = useRuntime();
  useClientSnapshot();
  return runtime.can(method);
}
export function useRepository<T>(
  repository: Pick<Repository<T>, "getSnapshot" | "subscribe">,
): readonly T[] {
  return useSyncExternalStore(repository.subscribe, repository.getSnapshot);
}

export function useGate(
  feature: Feature | "admin" | "invitation" | "ops",
): Capability {
  const runtime = useRuntime();
  useClientSnapshot();
  return runtime.gate(feature);
}
