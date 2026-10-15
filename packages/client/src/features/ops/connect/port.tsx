import { createContext, useContext } from "react";
import type { ReactElement, ReactNode } from "react";
import { AppError } from "@talos/base";
import { useRuntime } from "../../../platform/react/context.tsx";
import type { OpsPort } from "../model/port.ts";

const PortContext = createContext<OpsPort | null>(null);

/** Supplies the ops port; component previews and tests pass a fake that never reaches a network. */
export function OpsPortProvider({
  port,
  children,
}: {
  port: OpsPort;
  children: ReactNode;
}): ReactElement {
  return <PortContext.Provider value={port}>{children}</PortContext.Provider>;
}

export function useOpsPort(): OpsPort {
  const port = useContext(PortContext);
  if (!port) throw new AppError("E_INTERNAL", "缺少运维环境");
  return port;
}

/** The live client runtime as the ops port. */
export function OpsLiveProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return <OpsPortProvider port={useRuntime()}>{children}</OpsPortProvider>;
}
