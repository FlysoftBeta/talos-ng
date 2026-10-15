import { createContext, useContext, useState } from "react";
import type { ReactNode, ReactElement } from "react";
import { createPortal } from "react-dom";
import "./floating.css";

const RootLayer = createContext<HTMLElement | null>(null);
export const FloatingLayer = createContext<HTMLElement | null>(null);

/** One unclipped, themed layer per application; modal layers remain siblings. */
export function LayerProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return (
    <RootLayer.Provider value={host}>
      <FloatingLayer.Provider value={host}>
        {children}
        <div ref={setHost} className="portal-root" />
      </FloatingLayer.Provider>
    </RootLayer.Provider>
  );
}

export function Portal({
  children,
  modal = false,
}: {
  children: ReactNode;
  modal?: boolean;
}): ReactElement | null {
  const root = useContext(RootLayer);
  const floating = useContext(FloatingLayer);
  const host = modal ? root : floating;
  return host ? createPortal(children, host) : null;
}
